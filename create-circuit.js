'use strict';

const fs = require('fs');
const util = require('util');

console.error(`\
Pipe design data from
"https://www.changpuak.ch/electronics/Direct-Coupled-Resonator-Bandpass.php" output
window to stdin to get ngspice netlist on stdout.
`);


/* Example designData string:

    Direct Coupled Resonator Bandpass Filter Designer
    https://www.changpuak.ch/electronics/Direct-Coupled-Resonator-Bandpass.php
    Javascript Version : 11. February 2015
    -----------------------------------------------------------------------------
    Design Data for a 4-Resonator Bandpass Filter.
    Center Frequency          :    14.500 MHz
    Bandwidth                 :    1.200 MHz  
    Passband Ripple           :    1 dB (Chebyshev Characteristic)
    System Impedance          :    50 Ohm 
    -----------------------------------------------------------------------------
    Coupling Capacitor : 61.09 pF
    Resonator #1 C : 322.73 pF // L : 300.00 nH
    Coupling Capacitor : 22.16 pF
    Resonator #2 C : 360.35 pF // L : 300.00 nH
    Coupling Capacitor : 19.08 pF
    Resonator #3 C : 360.35 pF // L : 300.00 nH
    Coupling Capacitor : 22.16 pF
    Resonator #4 C : 322.73 pF // L : 300.00 nH
    Coupling Capacitor : 61.09 pF
    -----------------------------------------------------------------------------
    Please verify by simulation that attenuation above passband is sufficient.
    Negative capacitances indicate an unhappy inductance.

 */

const designData = fs.readFileSync(process.stdin.fd, 'utf8');

const designRE = /^Design Data for a (?<title>.*)\nCenter Frequency\s+:\s+(?<sCenter>.*)\nBandwidth\s+:\s+(?<sBw>.*)\nPassband Ripple\s+:\s+(?<ripple>\S+) dB.*\nSystem Impedance\s+:\s+(?<z>\S+) Ohm\s*/m;
const design = designData.match(designRE);
const {title, sCenter, sBw, ripple, z} = design.groups;

const coupling = [];		// Each element will be capacitorValue.
const res = [];			// Each element will be {c: capacitorValue, l: inductorValue}.

// Regex to match "Coupling Capacitor : 61.09 pF"
const couplingRegex = /^Coupling Capacitor\s*:\s*(?<v>[\d.]+)\s*(?<u>[pnum])F/;

// Regex to match "Resonator #1 C : 322.73 pF // L : 300.00 nH"
const resonatorRegex = /^Resonator #\d+ C\s*:\s*(?<cv>[\d.]+)\s*(?<cu>[pnum])F\s*\/\/ L\s*:\s*(?<lv>[\d.]+)\s*(?<lu>[pnum])H/;

designData
  .split('\n')
  .forEach(line => {
    const coupleMatch = line.match(couplingRegex);
    if (coupleMatch) coupling.push(`${coupleMatch.groups.v}${coupleMatch.groups.u}`);
    const resMatch = line.match(resonatorRegex);
    if (resMatch) res.push({
      c: `${resMatch.groups.cv}${resMatch.groups.cu}`,
      l: `${resMatch.groups.lv}${resMatch.groups.lu}`,
    });
  });

const center = parseFloat(sCenter);
const bw = parseFloat(sBw);
const bpBottom = center - bw/2;
const bpTop = center + bw/2;

const plotBot = `${(bpBottom * 0.8).toFixed(1)}e6` ;
const plotTop = `${(bpTop * 1.2).toFixed(1)}e6`;

// tankN (where N = number of coupling capacitors) is the filter's output node.
const nTanks = coupling.length - 1;
let prevNode = 'filtIn';
const outNode = 'filtOut';

console.log(`
* ${title}
* Passband: ${bpBottom} - ${bpTop} MHz  ${ripple}dB ripple ${z}-ohm

Vin in 0 AC 1
Rin in ${prevNode}  ${z}
Rload ${outNode} 0 ${z}
\
${coupling.map((cc, n) => {
  n = +n;
  const nodeN = n + 1;

  // Name of this tank's hot end or filtOut if end of the line.
  const tankNode = (n == nTanks) ? outNode : `tank${nodeN}`;

  let ccString = `
CC${nodeN} ${prevNode} ${tankNode} ${cc}
`;
  if (n !== nTanks) {
    ccString += `\
CT${nodeN} ${tankNode} 0 ${res[n].c}
LT${nodeN} ${tankNode} 0 ${res[n].l}
`;

    prevNode = tankNode;
  }

  return ccString;
}).join('')}

* --- Control and Plotting ---
.control
  run
  set color0 = white
  set color1 = black
  set xgridwidth = 2
  
  ac lin 2001 1e6 33e6

  * Plot with a narrower view to inspect the skirts
  plot db(v(${outNode})) xlimit ${plotBot} ${plotTop} ylimit -80 0
.endc

.end
`)
