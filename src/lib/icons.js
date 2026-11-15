// Inline SVG icons. Each export returns a raw SVG string (24px, currentColor, aria-hidden).
// Use inside html`` templates: html`${icons.mapPin()}` — the strings are wrapped with raw() so they are not escaped.
import { raw } from "./dom.js";

const svg = (body, fill = false) =>
  raw(
    `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" ` +
      (fill
        ? `fill="currentColor"`
        : `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`) +
      `>${body}</svg>`
  );

export const mapPin = () => svg(`<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>`);
export const directions = () => svg(`<path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z"/><path d="M8.5 14v-2.5a1.5 1.5 0 0 1 1.5-1.5h5M13.5 8l2 2-2 2"/>`);
export const calendarPlus = () => svg(`<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>`);
export const copy = () => svg(`<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>`);
export const phone = () => svg(`<path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 5.3 5.3l1.4-2.2L19 14.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2z"/>`);
export const whatsapp = () => svg(`<path d="M3.5 20.5l1.3-4.4A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 8.5c0 3.2 2.800 6 6 6l1.300-1.500-2-1-.9.800c-.9-.4-1.700-1.200-2.100-2.100l.8-.9-1-2z"/>`);
export const external = () => svg(`<path d="M14 4h6v6M20 4l-9 9M18 14v4.500a1.500 1.500 0 0 1-1.500 1.500h-11A1.500 1.500 0 0 1 4 18.500v-11A1.500 1.500 0 0 1 5.500 6H10"/>`);
export const clock = () => svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.500V12l3 2"/>`);
export const hanger = () => svg(`<path d="M12 8.500a2 2 0 1 0-2-2M12 8.500v1.500L3.500 16a1.500 1.500 0 0 0 1 2.700h15a1.500 1.500 0 0 0 1-2.700L12 10"/>`);
export const car = () => svg(`<path d="M5 16.500V17a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-.5M16 16.500V17a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-.5"/><path d="M3.500 16.500v-4l2-5a1.500 1.500 0 0 1 1.400-1h10.200a1.500 1.500 0 0 1 1.400 1l2 5v4z"/><path d="M3.500 12.500h17"/><circle cx="7.500" cy="14.500" r=".6" fill="currentColor"/><circle cx="16.500" cy="14.500" r=".6" fill="currentColor"/>`);
export const plane = () => svg(`<path d="M10.500 13.500L4 12.500l-1-1.500 6-1.500L6.500 4h2l5.500 4.500 4-1a2 2 0 0 1 1 3.800l-4 1.200L13 19.500l-1.500-.5.500-5.500z"/>`);
export const bus = () => svg(`<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16M7 17v2.500M17 17v2.500"/><circle cx="8" cy="14" r=".7" fill="currentColor"/><circle cx="16" cy="14" r=".7" fill="currentColor"/>`);
export const bed = () => svg(`<path d="M3 18V6M3 14h18v4M21 14v-2.500a2.500 2.500 0 0 0-2.500-2.500H11v5"/><circle cx="7" cy="11" r="1.800"/>`);
export const info = () => svg(`<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.500"/><circle cx="12" cy="7.800" r=".6" fill="currentColor"/>`);
export const chevron = () => svg(`<path d="M9 5.500l6.500 6.500L9 18.500"/>`);
export const check = () => svg(`<path d="M4.500 12.500l5 5 10-11"/>`);
export const search = () => svg(`<circle cx="10.500" cy="10.500" r="6.500"/><path d="M15.500 15.500L20.500 20.500"/>`);
export const share = () => svg(`<path d="M12 15V3.500M7.500 8L12 3.500 16.500 8M5 12v6.500a1.500 1.500 0 0 0 1.500 1.500h11a1.500 1.500 0 0 0 1.500-1.500V12"/>`);
export const home = () => svg(`<path d="M3.500 11L12 3.500 20.500 11M5.500 9.500V20h13V9.500M10 20v-5.500h4V20"/>`);
export const menuDots = () => svg(`<circle cx="5.500" cy="12" r="1.600" fill="currentColor"/><circle cx="12" cy="12" r="1.600" fill="currentColor"/><circle cx="18.500" cy="12" r="1.600" fill="currentColor"/>`);
export const gift = () => svg(`<rect x="3.500" y="9" width="17" height="4" rx="1"/><path d="M5 13v7h14v-7M12 9v11M12 9c-1.500 0-4.500-.5-4.500-2.800a2 2 0 0 1 3.500-1.200c.8.900 1 3 1 4zM12 9c1.500 0 4.500-.5 4.500-2.800A2 2 0 0 0 13 5c-.8.900-1 3-1 4z"/>`);
export const heart = () => svg(`<path d="M12 20s-8-4.800-8-10.700A4.600 4.600 0 0 1 12 6.500a4.600 4.600 0 0 1 8 2.800C20 15.200 12 20 12 20z"/>`);
export const question = () => svg(`<circle cx="12" cy="12" r="8.500"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.7.400-1 .9-1 1.700"/><circle cx="12" cy="16.800" r=".6" fill="currentColor"/>`);
export const x = () => svg(`<path d="M6 6l12 12M18 6L6 18"/>`);

export default { mapPin, directions, calendarPlus, copy, phone, whatsapp, external, clock, hanger, car, plane, bus, bed, info, chevron, check, search, share, home, menuDots, gift, heart, question, x };
