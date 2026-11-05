/**
 * Icône décorative de chaque entrée de navigation, action d'accueil ou raccourci de travail
 * (`components/ui/AppIcon.vue`). Une entrée sans icône connue prend un point discret : le libellé
 * visible reste toujours le seul porteur du sens.
 */
const ICONS: Readonly<Record<string, string>> = {
  accueil: 'home',
  today: 'today',
  patients: 'patients',
  consultations: 'consultations',
  agenda: 'agenda',
  sales: 'sales',
  stock: 'stock',
  workshop: 'workshop',
  communication: 'communication',
  reports: 'reports',
  settings: 'settings',
  offline: 'offline',
  'new-patient': 'user-plus',
  'new-consultation': 'stethoscope',
  'start-exam': 'stethoscope',
  search: 'search',
  appointment: 'calendar-plus',
  'consultations-today': 'consultations',
  statistics: 'reports',
  arrival: 'arrival',
  'exams-in-progress': 'consultations',
  'exams-today': 'list',
  'cash-session': 'cash',
  'new-invoice': 'file-plus',
  invoices: 'file',
  staff: 'patients',
  'clinic-settings': 'building',
  catalog: 'tag',
}

export function iconOf(id: string): string {
  return ICONS[id] ?? 'dot'
}
