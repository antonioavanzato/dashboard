// Ключ доступа хранится только на этом устройстве.
// В репозитории его нет и быть не должно.
import { listOrders, UnauthorizedError } from './api.js';

const STORAGE_KEY = 'hub.bookings.apiKey';

// При входе по Face ID ключ живёт только здесь, в памяти вкладки.
let memoryKey = null;

export function setMemoryKey(key) {
  memoryKey = key;
}

/** Убирает открытый ключ с диска (после включения Face ID), в памяти он остаётся. */
export function removeStoredKey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // нечего стирать
  }
}

export function loadKey() {
  if (memoryKey) return memoryKey;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveKey(key) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Приватный режим: ключ проживёт до закрытия вкладки, это допустимо.
  }
}

export function clearKey() {
  memoryKey = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Нечего стирать.
  }
}

export async function verifyKey(key) {
  try {
    await listOrders(key);
    return true;
  } catch (error) {
    if (error instanceof UnauthorizedError) return false;
    throw error;
  }
}
