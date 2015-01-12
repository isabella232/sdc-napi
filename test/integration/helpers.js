/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for NAPI integration tests
 */

var assert = require('assert');
var bunyan = require('bunyan');
var config = require('../../lib/config');
var common = require('../lib/common');
var fmt = require('util').format;
var fs = require('fs');
var mod_client = require('../lib/client');
var path = require('path');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



// 198.18.0.0/15 is supposed to be used for benchmarking network devices,
// according to RFC 2544, and therefore shouldn't be used for anything:
var TEST_NET_FMT = '198.18.%d.%d';
var TEST_NET_PFX = '198.18.%d.';
var NIC_NET_PARAMS = ['gateway', 'netmask', 'vlan_id', 'nic_tag', 'resolvers',
    'routes'];
var CONFIG_FILE = path.normalize(__dirname + '/../../config.json');
var CONF = config.load(CONFIG_FILE);
var DEFAULT_NIC_TAG = 'int_test_' + process.pid;
var NET_NUM = 0;



// --- Exported functions



/*
 * Add network parameters from state.network to a nic
 */
function addNetParamsToNic(state, params) {
    NIC_NET_PARAMS.forEach(function (n) {
        if (state.network.hasOwnProperty(n)) {
            params[n] = state.network[n];
        }
    });

    params.network_uuid = state.network.uuid;
}


/**
 * Create a NAPI client pointed at the local zone's NAPI (with a req_id for
 * tracking requests)
 */
function createNAPIclient(t) {
    var client = common.createClient('http://localhost:' + CONF.port, t);
    if (!mod_client.initialized()) {
        mod_client.set(client);
    }

    return client;
}


/**
 * Creates a nic tag for testing; stores the result in state.nicTag, or
 * state[targetName] if targetName is specified
 */
function createNicTag(t, napi, state, targetName, callback) {
    var name = DEFAULT_NIC_TAG;
    if (targetName) {
        if (typeof (targetName) === 'function') {
            callback = targetName;
            targetName = null;
        } else {
            name = name + '_' + targetName;
        }
    }

    napi.createNicTag(name, function (err, res) {
        common.ifErr(t, err, 'creating nic tag ' + name);
        if (res) {
            t.ok(res.uuid,
                util.format('test nic tag: uuid=%s, name=%s', res.uuid,
                    res.name));
            if (targetName) {
                state[targetName] = res;
            } else {
                state.nicTag = res;
            }

            if (!state.hasOwnProperty('nic_tags')) {
                state.nic_tags = [];
            }

            state.nic_tags.push(res);
        }

        if (callback) {
            return callback(err, res);
        } else {
            return t.end();
        }
    });
}


/**
 * Creates all of the nic tags specified in tags
 */
function createNicTags(t, napi, state, tags, callback) {
    vasync.forEachParallel({
        inputs: tags,
        func: createNicTag.bind(null, t, napi, state)
    }, function (err, res) {
        if (callback) {
            return callback(err, res);
        }

        return t.end();
    });
}


/**
 * Deletes the testing nic tag stored in state.nicTag or state[name], if
 * name is specified
 */
function deleteNicTag(t, napi, state, name, callback) {
    var tagName = state.nicTag.name;
    if (name) {
        if (typeof (name) === 'function') {
            callback = name;
            name = null;
        } else {
            tagName = state[name].name;
        }
    }


    napi.deleteNicTag(tagName, function (err) {
        t.ifError(err, 'delete test nic tag: ' + tagName);
        if (callback) {
            return callback(err);
        }

        return t.end();
    });
}


/**
 * Deletes all nic tags in state.nic_tags
 */
function deleteNicTags(t, napi, state) {
    if (!state.hasOwnProperty('nic_tags') || state.nic_tags.length === 0) {
        return t.end();
    }

    vasync.forEachParallel({
        inputs: state.nic_tags,
        func: function _delNicTag(tag, cb) {
            napi.deleteNicTag(tag.name, function (err) {
                common.ifErr(t, err, 'delete test nic tag: ' + tag.name);

                // We're calling this in teardown, so plow on anyway with
                // deleting the rest of the tags
                return cb();
            });
        }
    }, function (err) {
        return t.end();
    });
}


/**
 * Delete networks created in previous integration tests
 */
function deletePreviousNetworks(t) {
    var napi = mod_client.get();
    var matching = [];

    napi.listNetworks({}, function (err, obj, _, res) {
        if (common.ifErr(t, err, 'list networks')) {
            return t.end();
        }

        if (!obj || obj.length === 0) {
            t.pass('No networks in list');
            return t.end();
        }

        var nameRE = /^networks*-integration-[\d]+/;
        obj.forEach(function (n) {
            if (nameRE.test(n.name)) {
                matching.push(n);
            }
        });

        if (matching.length === 0) {
            t.pass('No previous networks to delete');
            return t.end();
        }

        vasync.forEachParallel({
            inputs: matching,
            func: function _delOne(net, cb) {
                napi.deleteNetwork(net.uuid, { force: true }, function (dErr) {
                    common.ifErr(t, err, fmt('delete network %s (%s)',
                        net.uuid, net.name));

                    return cb();
                });
            }
        }, function () {
            return t.end();
        });
    });
}


/*
 * Creates a network for testing; stores the result in state.network
 */
function createNetwork(t, napi, state, extraParams, targetName, callback) {
    if (typeof (targetName) === 'function') {
        callback = targetName;
        targetName = null;
    }

    var params = validNetworkParams(extraParams);
    if (targetName) {
        params.name = params.name + '-' + targetName;
    }

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            if (callback) {
                return callback(err);
            }
            return t.end();
        }

        t.ok(res.uuid, 'test network uuid: ' + res.uuid);

        params.uuid = res.uuid;
        if (!params.resolvers) {
            params.resolvers = [];
        }
        params.netmask = util_ip.bitsToNetmask(params.subnet.split('/')[1]);
        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);
        if (targetName) {
            state[targetName] = res;
        } else {
            state.network = res;
        }

        if (callback) {
            return callback();
        }
        return t.end();
    });
}


/**
 * Deletes the testing network stored in state.network
 */
function deleteNetwork(t, napi, state, name, callback) {
    var net = state.network;
    if (name) {
        if (typeof (name) === 'function') {
            callback = name;
        } else {
            net = state[name];
        }
    }

    napi.deleteNetwork(net.uuid, { force: true }, function (err) {
        common.ifErr(t, err, 'delete network ' + net.name);
        if (callback) {
            return callback(err);
        }

        return t.end();
    });
}


/**
 * Logs relevant information about the error, and ends the test
 */
function doneWithError(t, err, desc) {
    t.ifError(err, desc);

    if (err.body.hasOwnProperty('errors')) {
        t.deepEqual(err.body.errors, {}, 'display body errors');
    }
    return t.end();
}


/**
 * Asserts that substr is a substring or match for str. Similar to tap's
 * similar() (that's a little test humour for you).
 */
function similar(t, str, substr, message) {
    t.ok((str.indexOf(substr) !== -1) || (str == substr), message);
}


/**
 * Returns parameters suitable for creating a valid network
 */
function validNetworkParams(extraParams) {
    var params = {
        name: fmt('network-integration-%d-%d', process.pid, NET_NUM),
        vlan_id: 0,
        subnet: fmt(TEST_NET_FMT, NET_NUM, 0) + '/24',
        provision_start_ip: fmt(TEST_NET_FMT, NET_NUM, 5),
        provision_end_ip: fmt(TEST_NET_FMT, NET_NUM, 250),
        nic_tag: DEFAULT_NIC_TAG
    };

    NET_NUM++;

    for (var p in extraParams) {
        params[p] = extraParams[p];
    }

    return params;
}



module.exports = {
    addNetParamsToNic: addNetParamsToNic,
    createNAPIclient: createNAPIclient,
    createNetwork: createNetwork,
    createNicTag: createNicTag,
    createNicTags: createNicTags,
    deleteNetwork: deleteNetwork,
    deleteNicTag: deleteNicTag,
    deleteNicTags: deleteNicTags,
    deletePreviousNetworks: deletePreviousNetworks,
    doneWithError: doneWithError,
    ifErr: common.ifErr,
    invalidParamErr: common.invalidParamErr,
    get lastNetPrefix() {
        return fmt(TEST_NET_PFX, NET_NUM - 1);
    },
    nicNetParams: NIC_NET_PARAMS,
    randomMAC: common.randomMAC,
    similar: similar,
    ufdsAdminUuid: CONF.ufdsAdminUuid,
    validNetworkParams: validNetworkParams
};
