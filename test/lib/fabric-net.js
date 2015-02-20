/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for dealing with fabric networks
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var fmt = require('util').format;
var log = require('./log');
var mod_client = require('./client');
var mod_vasync = require('vasync');
var util = require('util');
var util_ip = require('../../lib/util/ip');

var doneErr = common.doneErr;
var doneRes = common.doneRes;


// --- Globals



var NUM = 0;
var TYPE = 'fabric-network';



// --- Exports



/**
 * Add expected fields from the last created fabric network to the passed-in
 * network - useful for filling in expected values
 */
function addLastCreatedFabricNetFields(net) {
    assert.object(net, 'net');
    assert.string(net.subnet, 'net.subnet');

    net.netmask = util_ip.bitsToNetmask(net.subnet.split('/')[1]);
    net.uuid = lastCreatedFabricNet().uuid;
}


/**
 * Create a network and compare the output
 */
function createFabricNet(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();
    var params = clone(opts.params);
    var owner = params.owner_uuid;
    var vlan = params.vlan_id;

    if (params.name == '<generate>') {
        params.name = generateNetworkName();
    }
    opts.reqType = 'create';
    opts.type = TYPE;
    opts.idKey = 'uuid';

    delete params.owner_uuid;
    delete params.vlan_uuid;

    if (opts.fillInMissing && opts.exp) {
        opts.exp.netmask = util_ip.bitsToNetmask(opts.exp.subnet.split('/')[1]);
        if (!opts.params.resolvers && !opts.exp.resolvers) {
            opts.exp.resolvers = [];
        }
    }

    client.createFabricNetwork(owner, vlan, params, common.reqOpts(t),
        common.afterAPIcall.bind(null, t, opts,
            function _afterCreate(err, net) {

        if (err) {
            return doneErr(err, t, callback);
        }

        if (opts.fillInMissing && opts.exp) {
            opts.exp.uuid = net.uuid;
        }

        return doneRes(net, t, callback);
    }));
}


/**
 * Create a fabric network, compare the output, then do the same for a get of
 * that fabric network.
 */
function createAndGetFabricNet(t, opts, callback) {
    opts.reqType = 'create';
    createFabricNet(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        opts.uuid = res.uuid;
        opts.reqType = 'get';
        return getFabricNet(t, opts, callback);
    });
}


/**
 * Delete all the fabric networks created by this test
 */
function delAllCreatedFabricNets(t) {
    assert.object(t, 't');

    var created = common.allCreated('fabric-networks');
    if (created.length === 0) {
        t.ok(true, 'No networks created');
        return t.end();
    }

    mod_vasync.forEachParallel({
        inputs: created,
        func: function _delOne(net, cb) {
            var delOpts = {
                continueOnErr: true,
                exp: {},
                params: net
            };

            delFabricNet(t, delOpts, cb);
        }
    }, function () {
        return t.end();
    });
}


/**
 * Delete a network
 */
function delFabricNet(t, opts, callback) {
    common.assertArgs(t, opts, callback);
    var client = opts.client || mod_client.get();
    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    var vlan = opts.params.vlan_id;
    var net = opts.params.uuid;

    opts.type = TYPE;
    opts.id = opts.uuid;
    opts.id = fmt('owner_uuid=%s, vlan_id=%d, uuid=%s',
        params.owner_uuid, params.vlan_id, params.uuid);
    delete params.owner_uuid;
    delete params.uuid;
    delete params.vlan_uuid;

    client.deleteFabricNetwork(owner, vlan, net, params,
        common.afterAPIdelete.bind(null, t, opts, callback));
}


/**
 * Generate a unique network name
 */
function generateNetworkName(name) {
    return fmt('test-%s-net%d-%d', (name ? name : 'fabric'),
        NUM++, process.pid);
}


/**
 * Get a fabric network and compare the output
 */
function getFabricNet(t, opts, callback) {
    common.assertArgs(t, opts, callback);
    var client = opts.client || mod_client.get();
    var net = opts.params.uuid;
    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    var vlan = opts.params.vlan_id;

    log.debug({ params: opts.params }, 'getting fabric network');
    opts.type = TYPE;
    opts.reqType = 'get';

    delete params.owner_uuid;
    delete params.uuid;
    delete params.vlan_id;

    client.getFabricNetwork(owner, vlan, net, params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Returns the most recently created network
 */
function lastCreatedFabricNet() {
    return common.lastCreated('fabric-networks');
}


/**
 * List fabric networks
 */
function list(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalArrayOfObject(opts.present, 'opts.present');

    var client = opts.client || mod_client.get();
    var desc = ' ' + JSON.stringify(opts.params)
        + (opts.desc ? (' ' + opts.desc) : '');
    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    var vlan = opts.params.vlan_id;

    if (!opts.desc) {
        opts.desc = desc;
    }

    delete params.vlan_id;
    delete params.owner_uuid;
    opts.type = TYPE;
    opts.id = 'uuid';

    log.debug({ params: params }, 'list fabric networks');

    client.listFabricNetworks(owner, vlan, params,
        common.afterAPIlist.bind(null, t, opts, callback));
}


/**
 * Update a fabric network and compare the output
 */
function updateFabricNetwork(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();

    opts.type = TYPE;
    opts.reqType = 'update';

    client.updateFabricNetwork(opts.uuid, opts.params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Update a fabric network, compare the output, then do the same for a get of
 * that fabric network.
 */
function updateAndGet(t, opts, callback) {
    updateFabricNetwork(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        return getFabricNet(t, opts, callback);
    });
}



module.exports = {
    addLastCreatedFields: addLastCreatedFabricNetFields,
    create: createFabricNet,
    createAndGet: createAndGetFabricNet,
    del: delFabricNet,
    delAllCreated: delAllCreatedFabricNets,
    generateName: generateNetworkName,
    get: getFabricNet,
    lastCreated: lastCreatedFabricNet,
    list: list,
    update: updateFabricNetwork,
    updateAndGet: updateAndGet
};