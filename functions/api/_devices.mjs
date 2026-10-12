// Device name locks: a browser that has chosen a name keeps a secret token; the server
// keeps only its hash, so the admin can list a person's devices and reset any of them.
// A guard against picking somebody else's name by mistake, not a login.
export const MAX_DEVICES_PER_PERSON = 10;

export function newDeviceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "dev_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashDeviceToken(token) {
  const data = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// "iPhone, Safari" from a user-agent string: just enough for the admin to tell devices apart.
export function deviceLabel(ua) {
  const s = String(ua || "");
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "Mac" : /CrOS/.test(s) ? "Chromebook" : /Linux/.test(s) ? "Linux" : "";
  const browser = /EdgA?\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Firefox|FxiOS/.test(s) ? "Firefox" : /SamsungBrowser/.test(s) ? "Samsung Internet" : /Chrome|CriOS/.test(s) ? "Chrome" : /Safari/.test(s) ? "Safari" : "";
  return [os, browser].filter(Boolean).join(", ") || "Unknown device";
}
