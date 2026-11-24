// Builds the MicroPython programs that run on the hub.
// Each step prints a marker line ("@ADIM n") so the app can tell the
// screen reader exactly what the robot is doing at that moment.

const PORT_CONST = ['port.A', 'port.B', 'port.C', 'port.D', 'port.E', 'port.F'];

export function motorOneTurnProgram(portIndex) {
  const port = PORT_CONST[portIndex];
  return [
    'import motor, runloop',
    'from hub import port',
    '',
    'async def main():',
    '    print("@BASLA")',
    '    print("@ADIM 1")',
    `    await motor.run_for_degrees(${port}, 360, 360)`,
    '    print("@BITTI")',
    '',
    'runloop.run(main())',
    '',
  ].join('\n');
}

// Parses a console line from the hub.
// Returns { type: 'start' | 'step' | 'done' | 'error' | 'text', step?, text }
export function parseConsoleLine(line) {
  if (line === '@BASLA') return { type: 'start' };
  if (line === '@BITTI') return { type: 'done' };
  const m = /^@ADIM (\d+)$/.exec(line);
  if (m) return { type: 'step', step: Number(m[1]) };
  if (/Traceback|Error|Hata/i.test(line)) return { type: 'error', text: line };
  return { type: 'text', text: line };
}
