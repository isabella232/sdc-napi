/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Integration tests for /networks endpoints
 */

'use strict';

var config = require('../lib/config');
var constants = require('../../lib/util/constants');
var fmt = require('util').format;
var h = require('./helpers');
var mod_jsprim = require('jsprim');
var mod_net = require('../lib/net');
var mod_uuid = require('node-uuid');
var mod_vasync = require('vasync');
var test = require('tape');
var util = require('util');

var extend = mod_jsprim.mergeObjects;


// --- Globals



var napi = h.createNAPIclient();
var OWNERS = [
    mod_uuid.v4()
];
var NETS = [
    h.validNetworkParams({
        owner_uuids: [ OWNERS[0] ]
    })
];
var state = { };



// --- Setup


test('create test nic tag', function (t) {
    h.createNicTag(t, napi, state);
});


test('create second test nic tag', function (t) {
    h.createNicTag(t, napi, state, 'nicTag2');
});


test('delete previously created networks', function (t) {
    h.deletePreviousNetworks(t);
});



// --- Tests



test('POST /networks (invalid nic tag)', function (t) {
    var params = {
        name: 'networks-integration-' + process.pid + '-invalid',
        vlan_id: 2,
        subnet: '10.77.77.0/24',
        provision_start_ip: '10.77.77.5',
        provision_end_ip: '10.77.77.250',
        nic_tag: 'invalid_tag',
        gateway: '10.77.77.1',
        resolvers: ['1.2.3.4', '10.77.77.2']
    };

    napi.createNetwork(params, function (err, res) {
        t.ok(err, 'error creating network');
        if (!err) {
            return t.end();
        }

        t.deepEqual(err.body, {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [
                {
                    code: 'InvalidParameter',
                    field: 'nic_tag',
                    message: 'nic tag does not exist'
                }
            ]
        }, 'Error is correct');

        return t.end();
    });
});


test('POST /networks', function (t) {
    var params = {
        name: 'networks-integration-' + process.pid,
        vlan_id: 0,
        // "TEST-NET-1" in RFC 5737:
        subnet: '192.0.2.0/24',
        provision_start_ip: '192.0.2.5',
        provision_end_ip: '192.0.2.250',
        nic_tag: state.nicTag.name,
        gateway: '192.0.2.1',
        resolvers: ['1.2.3.4', '192.0.2.2']
    };

    napi.createNetwork(params, function (err, res) {
        if (h.ifErr(t, err, 'create network')) {
            t.end();
            return;
        }

        params.family = 'ipv4';
        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.uuid = res.uuid;
        state.network = res;
        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

        return t.end();
    });
});


test('Create network on second nic tag', function (t) {
    var params = {
        nic_tag: state.nicTag2.name
    };
    h.createNetwork(t, napi, state, params, 'network2');
});


test('validate IPs created with network', function (t) {
    var ips = [ '192.0.2.1', '192.0.2.2'].reduce(function (arr, i) {
            arr.push({
                ip: i,
                belongs_to_uuid: config.server.ufdsAdminUuid,
                belongs_to_type: 'other',
                network_uuid: state.network.uuid,
                owner_uuid: config.server.ufdsAdminUuid,
                reserved: true,
                free: false
            });
            return arr;
        }, []);

    function checkIP(params, cb) {
        napi.getIP(state.network.uuid, params.ip, function (err, res) {
            t.ifError(err, 'get IP: ' + params.ip);
            if (err) {
                return cb(err);
            }
            t.deepEqual(res, params, 'params for IP ' + params.ip);
            return cb();
        });
    }

    mod_vasync.forEachParallel({
        func: checkIP,
        inputs: ips
    }, function (err) {
        t.ifError(err, 'getting all IPs should succeed');
        t.end();
    });
});


test('GET /networks/:uuid', function (t) {
    napi.getNetwork(state.network.uuid, function (err, res) {
        t.ifError(err, 'get network: ' + state.network.uuid);
        if (err) {
            return t.end();
        }

        t.deepEqual(res, state.network, 'network params correct');
        return t.end();
    });
});


test('GET /networks/admin', function (t) {
    napi.getNetwork('admin', function (err, res) {
        t.ifError(err, 'get admin network');
        if (err) {
            return t.end();
        }

        t.equal(res.name, 'admin', 'admin network found');
        return t.end();
    });
});


test('GET /networks', function (t) {

    t.test('list all networks', function (t2) {
        mod_net.list(t2, {
            present: [ state.network, state.network2 ]
        });
    });


    t.test('list networks: OR name', function (t2) {
        mod_net.list(t2, {
            params: {
                name: [ state.network.name, state.network2.name ]
            },
            deepEqual: true,
            present: [ state.network, state.network2 ]
        });
    });


    t.test('create network with different owner', function (t2) {
        mod_net.create(t2, {
            fillInMissing: true,
            params: NETS[0],
            exp: NETS[0]
        });
    });


    t.test('list all networks: provisionable_by', function (t2) {
        mod_net.list(t2, {
            params: {
                provisionable_by: OWNERS[0]
            },
            present: [ state.network, state.network2 ]
        });
    });

});


test('GET /networks (filtered)', function (t) {
    var desc = util.format(' (name=%s)', state.network.name);

    mod_net.list(t, {
        params: {name: state.network.name},
        present: []
    }, function (err, res) {
        t.ok(res, 'list returned' + desc);
        if (err || !res) {
            return t.end();
        }

        t.equal(res.length, 1, 'only matches one network' + desc);
        t.deepEqual(res[0], state.network, 'network params match' + desc);
        return t.end();
    });
});

test('GET /networks?uuid=$existing_prefix', function (t) {
    var uuid = state.network.uuid;
    var prefix = uuid.substring(0, 8) + '*';
    mod_net.list(t, {
        params: {uuid: prefix},
        present: [ state.network ]
    });
});

test('GET /networks?uuid=badcafe*', function (t) {
    mod_net.list(t, {
        params: {uuid: 'badcafe*'},
        present: []
    });
});

test('GET /networks?uuid=badcafe', function (t) {
    mod_net.list(t, {
        params: {uuid: 'badcafe'},
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [
                {
                    field: 'Invalid UUID',
                    code: 'InvalidParameter',
                    message: 'Invalid parameters'
                }
            ]
        }
    });
});

test('GET /networks?uuid=$SOME_UUID', function (t) {
    mod_net.list(t, {
        params: {uuid: 'e80a3efa-5158-11e7-a3ff-fbd21a3ddd8b'},
        present: []
    });
});

test('GET /networks?uuid=*badcafe', function (t) {
    mod_net.list(t, {
        params: {uuid: '*badcafe'},
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [
                {
                    field: 'uuid',
                    code: 'InvalidParameter',
                    message: 'only UUID prefixes are allowed'
                }
            ]
        }
    });
});

test('GET /networks?uuid=*badcafe*', function (t) {
    mod_net.list(t, {
        params: {uuid: '*badcafe*'},
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [
                {
                    field: 'uuid',
                    code: 'InvalidParameter',
                    message: 'need only 1 wildcard'
                }
            ]
        }
    });
});

test('GET /networks (filter: multiple nic tags)', function (t) {

    t.test('multiple nic tags: array', function (t2) {
        mod_net.list(t2, {
            params: {
                nic_tag: [ state.nicTag.name, state.nicTag2.name ]
            },
            deepEqual: true,
            present: [ state.network, state.network2, NETS[0] ]
        });
    });


    t.test('multiple nic tags: comma-separated', function (t2) {
        mod_net.list(t2, {
            params: {
                nic_tag: state.nicTag.name + ',' + state.nicTag2.name
            },
            deepEqual: true,
            present: [ state.network, state.network2, NETS[0] ]
        });
    });

});


test('POST /networks (empty gateway)', function (t) {
    var params = h.validNetworkParams({ gateway: '' });

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            t.end();
            return;
        }

        params.family = 'ipv4';
        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.uuid = res.uuid;
        params.resolvers = [];
        delete params.gateway;

        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);
        state.network3 = res;

        return t.end();
    });
});


test('POST /networks (single resolver)', function (t) {
    var params = h.validNetworkParams({ resolvers: ['8.8.4.4'] });

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            t.end();
            return;
        }

        params.family = 'ipv4';
        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.uuid = res.uuid;
        state.singleResolver = res;

        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

        napi.getNetwork(res.uuid, function (err2, res2) {
            t.ifError(err2, 'create network');
            if (err2) {
                t.end();
                return;
            }

            t.deepEqual(res2, params, 'get parameters for network ' + res.uuid);
            t.end();
        });
    });
});


test('POST /networks (comma-separated resolvers)', function (t) {
    var params = h.validNetworkParams();
    params.resolvers = fmt('8.8.4.4,%s1', h.lastNetPrefix);

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            t.end();
            return;
        }

        params.family = 'ipv4';
        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.resolvers = params.resolvers.split(',');
        params.uuid = res.uuid;

        state.commaResolvers = res;
        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

        napi.getNetwork(res.uuid, function (err2, res2) {
            t.ifError(err2, 'create network');
            if (err2) {
                t.end();
                return;
            }

            t.deepEqual(res2, params, 'get parameters for network ' + res.uuid);
            t.end();
        });
    });
});


test('network update: resolvers and name', function (tt) {

    var params = h.validNetworkParams({ resolvers: ['8.8.4.4'] });
    var updateParams = {
        name: mod_net.name(),
        resolvers: ['1.2.3.4', '8.8.8.8']
    };

    tt.test('create network', function (t) {
        mod_net.create(t, {
            fillInMissing: true,
            params: params,
            exp: params
        });
    });


    tt.test('update network', function (t) {
        params = extend(params, updateParams);
        updateParams.uuid = params.uuid;

        mod_net.update(t, {
            params: updateParams,
            exp: params
        });
    });


    tt.test('get network', function (t) {
        mod_net.get(t, {
            params: {
                uuid: params.uuid
            },
            exp: params
        });
    });

});



// --- Teardown



test('teardown', function (t) {

    t.test('DELETE /networks/:uuid', function (t2) {
        var names = ['network', 'network2', 'network3', 'singleResolver',
            'commaResolvers'];

        function deleteNet(n, cb) {
            if (!state.hasOwnProperty(n)) {
                return cb();
            }
            napi.deleteNetwork(state[n].uuid, { force: true }, function (err) {
                t2.ifError(err, 'delete network ' + n);
                return cb();
            });
        }

        mod_vasync.forEachParallel({
            func: deleteNet,
            inputs: names
        }, function () {
            return t2.end();
        });
    });


    t.test('delete created networks', mod_net.delAllCreated);


    t.test('remove test nic tag', function (t2) {
        h.deleteNicTag(t2, napi, state);
    });


    t.test('remove second test nic tag', function (t2) {
        h.deleteNicTag(t2, napi, state, 'nicTag2');
    });

});
