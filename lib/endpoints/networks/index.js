/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /networks endpoints
 */

'use strict';

var assert = require('assert-plus');
var errors = require('../../util/errors');
var mod_common = require('./common');
var mod_net = require('../../models/network');
var mod_pool = require('../../models/network-pool');
var reqToOpts = require('../../util/common').reqToOpts;
var restify = require('restify');



// --- Internal helpers



/**
 * Ensures the network isn't in use in a network pool
 */
function ensureNetworkUnused(req, res, next) {
    mod_pool.list({
        app: req.app,
        log: req.log,
        params: {
            networks: [ req.params.uuid ]
        }
    }, function (err, usedBy) {
        if (err) {
            next(err);
            return;
        }

        if (usedBy.length === 0) {
            next();
            return;
        }

        var usedByErrs = usedBy.map(function (pool) {
            return errors.usedBy('network pool', pool.uuid);
        });

        next(new errors.InUseError('Network is in use', usedByErrs));
    });
}



// --- Endpoints



/**
 * GET /networks: list all logical networks
 */
function listNetworks(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.list(opts, function (err, results) {
        req.log.debug('listNetworks: cb entry');
        if (err) {
            return next(err);
        }

        var nets = [];
        for (var n in results) {
            nets.push(results[n].serialize());
        }

        res.send(200, nets);
        next();
    });
}


/**
 * GET /networks/:uuid: get an individual network
 */
function getNetwork(req, res, next) {
    assert.object(req._network, 'req._network');

    req.log.trace('getNetwork: cb entry');
    res.header('Etag', req._network.etag);
    res.send(200, req._network.serialize());
    next();
}


/**
 * POST /networks: create a network
 */
function postNetwork(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.create(opts, function (err, net) {
        req.log.debug('postNetwork: cb entry');
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', net.etag);
        res.send(200, net.serialize());

        next();
    });
}


/**
 * PUT /networks: update a network
 */
function putNetwork(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.update(opts, function (err, net) {
        req.log.debug('putNetwork: cb entry');
        if (err) {
            next(err);
            return;
        }

        var ser = net.serialize();

        res.header('Etag', net.etag);
        res.send(200, ser);

        next();
    });
}


/**
 * DELETE /networks/:uuid: delete a network
 */
function deleteNetwork(req, res, next) {
    mod_net.del(reqToOpts(req, {
        existingNet: req._network
    }), function (err) {
        req.log.debug('deleteNetwork: cb entry');
        if (err) {
            return next(err);
        }
        res.send(204);
        return next();
    });
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    var netRequired = before.concat([
        mod_common.ensureNetworkExists.bind(null, 'uuid'),
        restify.conditionalRequest()
    ]);

    http.post({ path: '/networks', name: 'createnetwork' },
        before, postNetwork);
    http.get({ path: '/networks', name: 'listnetworks' },
        before, listNetworks);
    http.head({ path: '/networks', name: 'headnetworks' },
        before, listNetworks);

    http.get({ path: '/networks/:uuid', name: 'getnetwork' },
        netRequired, getNetwork);
    http.head({ path: '/networks/:uuid', name: 'headnetwork' },
        netRequired, getNetwork);

    http.put({ path: '/networks/:uuid', name: 'putnetwork' },
        netRequired, putNetwork);

    http.del({ path: '/networks/:uuid', name: 'deletenetwork' },
        netRequired.concat(ensureNetworkUnused), deleteNetwork);
}



module.exports = {
    register: register
};
