'use strict';
'require baseclass';
'require rpc';
'require uci';

// same RPC declarations as before
var callGetUnixtime = rpc.declare({ object: 'luci', method: 'getUnixtime', expect: { result: 0 }});
var callLuciVersion = rpc.declare({ object: 'luci', method: 'getVersion' });
var callSystemBoard = rpc.declare({ object: 'system', method: 'board' });
var callSystemInfo = rpc.declare({ object: 'system', method: 'info' });

function parseNssCpuLoad(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return undefined;
    for (var i = 0; i < lines.length; i++) {
        var raw = lines[i].trim();
        if (!raw) continue;
        var parts = raw.split(/\s+/);
        var digitTokens = parts.filter(function(p) { return /[0-9]/.test(p); });
        if (digitTokens.length >= 3) {
            var last3 = digitTokens.slice(-3);
            var minRaw = last3[0], avgRaw = last3[1], maxRaw = last3[2];
            var minNum = minRaw.replace(/[^0-9.+-]/g, ''), avgNum = avgRaw.replace(/[^0-9.+-]/g, ''), maxNum = maxRaw.replace(/[^0-9.+-]/g, '');
            if (!minNum || !avgNum || !maxNum) return undefined;
            var minDisplay = (minRaw.indexOf('%') !== -1) ? (minNum + '%') : minNum;
            var avgDisplay = (avgRaw.indexOf('%') !== -1) ? (avgNum + '%') : avgNum;
            var maxDisplay = (maxRaw.indexOf('%') !== -1) ? (maxNum + '%') : maxNum;
            return { min: minDisplay, avg: avgDisplay, max: maxDisplay };
        }
    }
    return undefined;
}

return baseclass.extend({
    title: _('System'),

    load: function() {
        // final element will come from either fs or CGI fetch
        var nssPromise = (function() {
            try {
                var fs = require('fs');
                return fs.lines('/sys/kernel/debug/qca-nss-drv/stats/cpu_load_ubi')
                    .then(function(lines) {
                        try { return parseNssCpuLoad(lines); } catch (e) { console && console.error && console.error('nss: parse fs', e); return undefined; }
                    })
                    .catch(function(e) { console && console.error && console.error('nss: fs error', e && e.message?e.message:e); return undefined; });
            } catch (e) {
                // fs not available: fallback to CGI fetch
                return fetch('/cgi-bin/nss_load', { cache: 'no-store' })
                    .then(function(resp) { if (!resp.ok) return undefined; return resp.text(); })
                    .then(function(txt) { if (!txt) return undefined; var lines = txt.split(/\r?\n/); try { return parseNssCpuLoad(lines); } catch (e) { console && console.error && console.error('nss: parse fetch', e); return undefined; } })
                    .catch(function(e) { console && console.error && console.error('nss: fetch error', e && e.message?e.message:e); return undefined; });
            }
        })();

        return Promise.all([
            L.resolveDefault(callSystemBoard(), {}),
            L.resolveDefault(callSystemInfo(), {}),
            L.resolveDefault(callLuciVersion(), { revision: _('unknown version'), branch: 'LuCI' }),
            L.resolveDefault(callGetUnixtime(), 0),
            nssPromise,
            uci.load('system')
        ]);
    },

    render: function(data) {
        var boardinfo   = data[0],
            systeminfo  = data[1],
            luciversion = data[2],
            unixtime    = data[3],
            nssinfo     = data[4];

        luciversion = luciversion.branch + ' ' + luciversion.revision;

        var datestr = null;
        var ts = unixtime || systeminfo.localtime || 0;
        if (ts) {
            var date = new Date(ts * 1000),
                zn = uci.get('system', '@system[0]', 'zonename')?.replaceAll(' ', '_') || 'UTC',
                clock_style = uci.get('system', '@system[0]', 'clock_timestyle') || 0,
                clock_hourcycle = uci.get('system', '@system[0]', 'clock_hourcycle') || 0;

            datestr = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: (clock_style == 0) ? 'long' : 'full',
                hourCycle: (clock_hourcycle == 0) ? undefined : clock_hourcycle,
                timeZone: zn
            }).format(date);
        }

        var fields = [
            _('Hostname'),         boardinfo.hostname,
            _('Model'),            boardinfo.model,
            _('Architecture'),     boardinfo.system,
            _('Target Platform'),  (L.isObject(boardinfo.release) ? boardinfo.release.target : ''),
            _('Firmware Version'), (L.isObject(boardinfo.release) ? boardinfo.release.description + ' / ' : '') + (luciversion || ''),
            _('Kernel Version'),   boardinfo.kernel,
            _('Local Time'),       datestr,
            _('Uptime'),           systeminfo.uptime ? '%t'.format(systeminfo.uptime) : null,
            _('Load Average'),     Array.isArray(systeminfo.load) ? '%.2f, %.2f, %.2f'.format(
                systeminfo.load[0] / 65535.0,
                systeminfo.load[1] / 65535.0,
                systeminfo.load[2] / 65535.0
            ) : null,
            _('NSS Load'),         (L.isObject(nssinfo) && nssinfo.avg && nssinfo.max && nssinfo.min) ? 'Min: %s Avg: %s Max: %s'.format(nssinfo.min, nssinfo.avg, nssinfo.max) : null
        ];

        var table = E('table', { 'class': 'table' });

        for (var i = 0; i < fields.length; i += 2) {
            table.appendChild(E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td left', 'width': '33%' }, [ fields[i] ]),
                E('td', { 'class': 'td left' }, [ (fields[i + 1] != null) ? fields[i + 1] : '?' ])
            ]));
        }

        return table;
    }
});

