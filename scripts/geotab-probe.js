#!/usr/bin/env node
/*
 * Geotab probe — dumps LogRecords + Trips for one device on one date.
 *
 * Usage:
 *   GEOTAB_DB=<database> GEOTAB_USER=<user> GEOTAB_PASS=<password> \
 *     node scripts/geotab-probe.js <device-name-or-id> <YYYY-MM-DD>
 *
 * Examples:
 *   GEOTAB_DB=Bethrochel GEOTAB_USER=apiuser GEOTAB_PASS=xxx \
 *     node scripts/geotab-probe.js "Bus 06" 2026-04-22
 *
 *   GEOTAB_DB=Bethrochel GEOTAB_USER=apiuser GEOTAB_PASS=xxx \
 *     node scripts/geotab-probe.js b8 2026-04-22
 *
 * Prints:
 *   - Resolved device id + name
 *   - Every LogRecord for the device during the selected day (time, lat/lng,
 *     speed in km/h)
 *   - Every Trip for the device that touches the selected day (start/stop
 *     times, stopPoint, startPoint, nextTripStart)
 *
 * Nothing is written anywhere. Credentials live only in env vars.
 */

'use strict';

var https = require('https');

function httpsJson(host, path, body) {
    return new Promise(function (resolve, reject) {
        var data = Buffer.from(JSON.stringify(body));
        var req = https.request({
            method: 'POST', host: host, path: path, port: 443,
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'content-length': data.length,
                'accept': 'application/json'
            }
        }, function (res) {
            var chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () {
                var raw = Buffer.concat(chunks).toString('utf8');
                try {
                    var j = JSON.parse(raw);
                    if (j.error) return reject(new Error(j.error.message + ' (' + (j.error.errors && j.error.errors[0] && j.error.errors[0].name || '') + ')'));
                    resolve(j.result);
                } catch (e) { reject(new Error('Non-JSON response: ' + raw.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function rpc(host, method, params) {
    return httpsJson(host, '/apiv1', { method: method, params: params });
}

async function main() {
    var db = process.env.GEOTAB_DB;
    var user = process.env.GEOTAB_USER;
    var pass = process.env.GEOTAB_PASS;
    if (!db || !user || !pass) {
        console.error('Missing env vars. Set GEOTAB_DB, GEOTAB_USER, GEOTAB_PASS.');
        process.exit(2);
    }
    var args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node scripts/geotab-probe.js <device-name-or-id> <YYYY-MM-DD>');
        process.exit(2);
    }
    var deviceArg = args[0];
    var dateStr = args[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        console.error('Date must be YYYY-MM-DD.');
        process.exit(2);
    }

    // 1. Authenticate against the canonical server; it may redirect to a
    //    tenant-specific host via the "path" field.
    var auth = await rpc('my.geotab.com', 'Authenticate', {
        database: db, userName: user, password: pass
    });
    var host = (auth.path && auth.path !== 'ThisServer') ? auth.path : 'my.geotab.com';
    var credentials = auth.credentials;
    console.error('[auth] database=' + credentials.database + '  user=' + credentials.userName + '  server=' + host);

    // 2. Resolve device by id (if arg looks like an id) or by name.
    var device = null;
    if (/^b[0-9a-f]+$/i.test(deviceArg)) {
        var byId = await rpc(host, 'Get', {
            typeName: 'Device', search: { id: deviceArg }, credentials: credentials
        });
        if (byId && byId.length) device = byId[0];
    }
    if (!device) {
        var byName = await rpc(host, 'Get', {
            typeName: 'Device', search: { name: deviceArg }, credentials: credentials
        });
        if (byName && byName.length) device = byName[0];
    }
    if (!device) {
        console.error('Device "' + deviceArg + '" not found.');
        process.exit(3);
    }
    console.error('[device] id=' + device.id + '  name=' + device.name + '  vin=' + (device.vehicleIdentificationNumber || ''));

    // 3. Build the ISO window for the day.
    var dayStart = new Date(dateStr + 'T00:00:00');
    var dayEnd = new Date(dateStr + 'T23:59:59');
    var fromIso = dayStart.toISOString();
    var toIso = dayEnd.toISOString();
    console.error('[window] ' + fromIso + '  ->  ' + toIso + '\n');

    // 4. Fetch LogRecords + Trips in parallel.
    var [logs, trips] = await Promise.all([
        rpc(host, 'Get', {
            typeName: 'LogRecord',
            search: { deviceSearch: { id: device.id }, fromDate: fromIso, toDate: toIso },
            resultsLimit: 50000,
            credentials: credentials
        }),
        rpc(host, 'Get', {
            typeName: 'Trip',
            search: { deviceSearch: { id: device.id }, fromDate: fromIso, toDate: toIso },
            credentials: credentials
        })
    ]);

    // 5. Print LogRecords in a human-readable table.
    logs.sort(function (a, b) { return new Date(a.dateTime) - new Date(b.dateTime); });
    console.log('==== LogRecords (' + logs.length + ') ====');
    console.log('time(UTC)                  | lat        | lng         | speed');
    for (var i = 0; i < logs.length; i++) {
        var lg = logs[i];
        var t = new Date(lg.dateTime);
        var spd = (typeof lg.speed === 'number') ? lg.speed.toFixed(1) : '—';
        console.log(
            t.toISOString().replace('T', ' ').slice(0, 19) + ' | ' +
            (typeof lg.latitude === 'number' ? lg.latitude.toFixed(5).padStart(10) : '—'.padStart(10)) + ' | ' +
            (typeof lg.longitude === 'number' ? lg.longitude.toFixed(5).padStart(11) : '—'.padStart(11)) + ' | ' +
            String(spd).padStart(6) + ' km/h'
        );
    }

    // 6. Print Trips.
    trips.sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    console.log('\n==== Trips (' + trips.length + ') ====');
    for (var j = 0; j < trips.length; j++) {
        var tr = trips[j];
        var startD = tr.start ? new Date(tr.start).toISOString() : '—';
        var stopD = tr.stop ? new Date(tr.stop).toISOString() : '—';
        var nextD = tr.nextTripStart ? new Date(tr.nextTripStart).toISOString() : '—';
        var sp = tr.startPoint ? (tr.startPoint.y.toFixed(5) + ',' + tr.startPoint.x.toFixed(5)) : '—';
        var ep = tr.stopPoint ? (tr.stopPoint.y.toFixed(5) + ',' + tr.stopPoint.x.toFixed(5)) : '—';
        console.log(
            '  [' + (j + 1) + '] start=' + startD + ' (' + sp + ')\n' +
            '      stop =' + stopD + ' (' + ep + ')\n' +
            '      nextTripStart=' + nextD + '  driverId=' + ((tr.driver && tr.driver.id) || '') + '  duration=' + (tr.duration || '')
        );
    }
}

main().catch(function (err) {
    console.error('ERROR: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
