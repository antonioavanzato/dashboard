// Справочник статусов заявки. Один в один с BookingStatus
// из HUB/CreatorHub/Models/SDBookingRequest.swift.
export const STATUSES = [
  { id: 'new', label: 'Новая' },
  { id: 'contacted', label: 'Связались' },
  { id: 'cancelled', label: 'Отказ' },
  { id: 'completed', label: 'Завершена' },
];

// Архив: заявки, которые больше не в работе.
export const ARCHIVE_STATUS_IDS = ['completed', 'cancelled'];

export function labelForStatus(id) {
  const found = STATUSES.find((s) => s.id === id);
  return found ? found.label : id;
}
