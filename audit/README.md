# Pattern.wly headless audit harness

Runs the inline app script from `../app.html` in a Node `vm` sandbox with a stub DOM
(parsed from the real markup, so id-wiring checks are genuine) and a stub THREE.

Usage:

    node audit/run.js            # audits ../app.html
    node audit/run.js file.html  # audits a specific file

Covers: NaN/bed/Z bounds at every SLIDER_RANGE extreme, extrusion-volume math,
weave base→wall bonding, speed caps, gcode structure, UI wiring + settings round-trip,
mobile download/copy/share paths, generation performance, and known bug classes
(blank inputs, duplicate profile points, spiralize with no floor, malformed share hash).
