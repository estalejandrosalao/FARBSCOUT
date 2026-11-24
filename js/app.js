const firebaseConfig = {
  apiKey: "AIzaSyBceYRJY7C3VcQW7K_Yt60c2LvhKGscz6M",
  authDomain: "farbscout.firebaseapp.com",
  projectId: "farbscout",
  storageBucket: "farbscout.firebasestorage.app",
  messagingSenderId: "545938383625",
  appId: "1:545938383625:web:45762d66ea57a853bd69d8",
  measurementId: "G-K0QD3QRCP1"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
const aiColorCache = new Map();

async function askAIColorName({ hex, r, g, b, hsl }) {
  if (aiColorCache.has(hex)) return aiColorCache.get(hex);

  const prompt = `Responde ÚNICAMENTE con el nombre comercial estándar en español (carta Pantone, RAL o diseño) del color HEX ${hex} (RGB: ${r}, ${g}, ${b}). Máximo 3 palabras, sin comillas, sin punto final ni explicaciones.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${firebaseConfig.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    const data = await res.json();
    if (!res.ok) {
      console.error("Error Gemini API:", res.status, data.error?.message || data);
      return null;
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const aiName = raw.trim().replace(/["'.\n]/g, "");

    if (aiName && aiName.length <= 40) {
      aiColorCache.set(hex, aiName);
      return aiName;
    }
  } catch (err) {
    console.error("Fallo de red al consultar Gemini:", err);
  }
  return null;
}

const COLOR_CATEGORIES = [
  { id: "Rojos", name: "Rojos", color: "#ef4444" },
  { id: "Naranjas", name: "Naranjas", color: "#f97316" },
  { id: "Amarillos", name: "Amarillos", color: "#eab308" },
  { id: "Verdes", name: "Verdes", color: "#22c55e" },
  { id: "Turquesas", name: "Turquesas", color: "#06b6d4" },
  { id: "Azules", name: "Azules", color: "#3b82f6" },
  { id: "Morados", name: "Morados", color: "#8c00d9" },
  { id: "Rosas", name: "Rosas", color: "#ec4899" },
  { id: "Negros", name: "Negros", color: "#18181b" },
  { id: "Grises", name: "Grises", color: "#71717a" },
  { id: "Blancos", name: "Blancos", color: "#f4f4f5" }
];

function emptyDiscovered() {
  return Object.fromEntries(COLOR_CATEGORIES.map(c => [c.id, []]));
}

function defaultState() {
  return {
    username: "Usuario",
    email: "",
    avatar: "",
    searches: 0,
    history: [],
    discovered: emptyDiscovered()
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === "password";
  input.type = isPass ? "text" : "password";
  btn.textContent = isPass ? "🙈" : "👁️";
}

function mapFirebaseAuthError(code) {
  switch (code) {
    case "auth/email-already-in-use":
      return "Ya existe una cuenta con este correo";
    case "auth/invalid-email":
      return "El formato del correo no es válido";
    case "auth/weak-password":
      return "La contraseña debe tener al menos 6 caracteres";
    case "auth/user-not-found":
    case "auth/invalid-credential":
      return "Correo o contraseña incorrectos";
    case "auth/wrong-password":
      return "Contraseña incorrecta";
    case "auth/too-many-requests":
      return "Demasiados intentos. Intenta más tarde";
    case "auth/unauthorized-domain":
      return "Dominio no autorizado en Firebase Authentication";
    case "auth/popup-blocked":
      return "El navegador bloqueó la ventana emergente de Google";
    default:
      return `Error de autenticación (${code || "desconocido"})`;
  }
}

async function registerUserAccount({ username, email, password }) {
  try {
    const cleanEmail = email.toLowerCase().trim();
    const cleanName = username.trim();
    const cred = await auth.createUserWithEmailAndPassword(cleanEmail, password);
    await cred.user.updateProfile({ displayName: cleanName });

    const newState = {
      ...defaultState(),
      username: cleanName,
      email: cleanEmail
    };

    await db.collection("users").doc(cred.user.uid).set(newState);
    return { ok: true, account: newState };
  } catch (err) {
    return { ok: false, error: mapFirebaseAuthError(err.code) };
  }
}

async function loginUserAccount(email, password) {
  try {
    const cleanEmail = email.toLowerCase().trim();
    const cred = await auth.signInWithEmailAndPassword(cleanEmail, password);
    const snap = await db.collection("users").doc(cred.user.uid).get();

    if (!snap.exists) {
      const fallback = {
        ...defaultState(),
        username: cred.user.displayName || "Usuario",
        email: cleanEmail
      };
      await db.collection("users").doc(cred.user.uid).set(fallback);
      return { ok: true, account: fallback };
    }

    const data = snap.data();
    return {
      ok: true,
      account: {
        ...defaultState(),
        ...data,
        discovered: { ...emptyDiscovered(), ...(data.discovered || {}) }
      }
    };
  } catch (err) {
    return { ok: false, error: mapFirebaseAuthError(err.code) };
  }
}

const GOOGLE_CLIENT_ID = "545938383625-9nb14jbpcg24m0qqgv121f4ff86kf3bh.apps.googleusercontent.com";

function loginWithGoogle() {
  return new Promise(resolve => {
    if (!window.google || !google.accounts || !google.accounts.id) {
      resolve({ ok: false, error: "Cargando Google, intenta de nuevo en un segundo" });
      return;
    }

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      use_fedcm_for_prompt: true,
      callback: async response => {
        try {
          const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
          const cred = await auth.signInWithCredential(credential);
          const user = cred.user;
          const userRef = db.collection("users").doc(user.uid);
          const snap = await userRef.get();

          if (!snap.exists) {
            const newState = {
              ...defaultState(),
              username: user.displayName || "Usuario",
              email: user.email || "",
              avatar: user.photoURL || ""
            };
            await userRef.set(newState);
            resolve({ ok: true, isNew: true });
            return;
          }
          resolve({ ok: true, isNew: false });
        } catch (err) {
          console.error("Error GIS Auth:", err);
          resolve({ ok: false, error: mapFirebaseAuthError(err.code) });
        }
      }
    });

    google.accounts.id.prompt(notification => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        resolve({ ok: false, error: "El navegador bloqueó el selector de Google. Verifica los permisos o usa tu correo." });
      }
    });
  });
}

async function sendPasswordReset(email) {
  try {
    await auth.sendPasswordResetEmail(email.toLowerCase().trim());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapFirebaseAuthError(err.code) };
  }
}

async function clearActiveSession() {
  await auth.signOut();
}

function initAuthenticatedPage(onReady) {
  auth.onAuthStateChanged(async user => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    try {
      const snap = await db.collection("users").doc(user.uid).get();
      let st;
      if (snap.exists) {
        const data = snap.data();
        st = {
          ...defaultState(),
          ...data,
          email: user.email || data.email || "",
          discovered: { ...emptyDiscovered(), ...(data.discovered || {}) }
        };
      } else {
        st = {
          ...defaultState(),
          username: user.displayName || "Usuario",
          email: user.email || ""
        };
        await db.collection("users").doc(user.uid).set(st);
      }
      onReady(st);
    } catch (err) {
      showToast("Error al cargar datos de la nube");
    }
  });
}

async function saveState(st) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await db.collection("users").doc(user.uid).set({
      username: st.username,
      email: st.email || user.email || "",
      avatar: st.avatar || "",
      searches: st.searches || 0,
      history: st.history || [],
      discovered: st.discovered || emptyDiscovered()
    }, { merge: true });
  } catch (err) {
    showToast("No se pudo sincronizar con la nube");
  }
}

function compressImageToDataURL(file, maxSize = 200) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function totalUniqueColors(st) {
  return Object.values(st.discovered || {}).reduce((s, arr) => s + arr.length, 0);
}

function unlockedCategoriesCount(st) {
  return Object.values(st.discovered || {}).filter(arr => arr.length > 0).length;
}

function getBannerTextStyles(hsl) {
  const isLight = hsl && hsl.l > 72;
  return {
    color: isLight ? "#121217" : "#ffffff",
    textShadow: isLight ? "none" : "0 1px 8px rgba(0, 0, 0, 0.65)"
  };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: Math.round(255 * f(0)), g: Math.round(255 * f(8)), b: Math.round(255 * f(4)) };
}

function classifyColor(r, g, b, { h, s, l }) {
  if (l <= 8 || (l <= 15 && s <= 18)) return "Negros";
  if (l >= 92 && s <= 18) return "Blancos";
  if (s <= 12) return "Grises";

  if (h < 15 || h >= 345) return "Rojos";
  if (h < 42) return "Naranjas";
  if (h < 68) return "Amarillos";
  if (h < 165) return "Verdes";
  if (h < 198) return "Turquesas";
  if (h < 255) return "Azules";
  if (h < 295) return "Morados";
  return "Rosas";
}

function nameColor(r, g, b, { h, s, l }, category) {
  if (s <= 10) {
    if (l <= 10) return "Negro Azabache";
    if (l <= 22) return "Negro Carbón";
    if (l <= 38) return "Gris Grafito";
    if (l <= 58) return "Gris Medio";
    if (l <= 78) return "Gris Plata";
    if (l <= 92) return "Gris Perla";
    return "Blanco Puro";
  }

  if (l < 18) {
    if (h >= 42 && h < 75) return "Oliva Oscuro";
    if (h >= 75 && h < 165) return "Bosque Profundo";
    if (h >= 165 && h < 200) return "Petróleo Oscuro";
    if (h >= 200 && h < 260) return "Azul Medianoche";
    if (h >= 260 && h < 330) return "Púrpura Oscuro";
    return "Vino Oscuro";
  }

  if (h < 15 || h >= 345) {
    if (l < 35) return "Rojo Borgoña";
    if (s < 45) return "Rojo Terracota";
    return l > 65 ? "Rojo Coral" : "Rojo Carmesí";
  }

  if (h < 32) {
    if (l < 35) return "Marrón Caoba";
    if (s < 45) return "Canela Suave";
    return "Naranja Quemado";
  }

  if (h < 45) {
    if (l < 35) return "Marrón Tierra";
    return l > 65 ? "Durazno" : "Naranja Ámbar";
  }

  if (h < 68) {
    if (l < 32) return "Verde Oliva";
    if (s < 45) return "Mostaza Apagado";
    return l > 72 ? "Amarillo Limón" : "Amarillo Dorado";
  }

  if (h < 140) {
    if (l < 32) return "Verde Pino";
    if (s < 40) return "Verde Salvia";
    return l > 68 ? "Verde Lima" : "Verde Esmeralda";
  }

  if (h < 170) {
    return l < 35 ? "Verde Jade Oscuro" : "Verde Menta";
  }

  if (h < 200) {
    if (l < 35) return "Cian Profundo";
    return l > 70 ? "Aguamarina" : "Turquesa";
  }

  if (h < 255) {
    if (l < 30) return "Azul Marino";
    if (s < 40) return "Azul Acero";
    return l > 68 ? "Azul Cielo" : "Azul Cobalto";
  }

  if (h < 290) {
    if (l < 35) return "Violeta Profundo";
    return l > 68 ? "Lavanda" : "Morado Intenso";
  }

  if (h < 330) {
    return l > 68 ? "Lila Rosado" : "Magenta";
  }

  return l > 70 ? "Rosa Pastel" : "Rosa Frambuesa";
}

let _toastTimer;
function showToast(text) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2700);
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
// FIN DEL ARCHIVO app.js
