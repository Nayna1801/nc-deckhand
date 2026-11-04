const cell = (v: string | number): string => {
  let s = String(v)
  // evita inyección de fórmulas al abrir el CSV en Excel/Sheets
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}
