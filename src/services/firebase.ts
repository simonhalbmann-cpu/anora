// src/services/firebase.ts
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDyJIUYVaO3RpWVIN9BLS8diNrcdDzuHD4",
  authDomain: "anoraapp-ai.firebaseapp.com",
  projectId: "anoraapp-ai",
  storageBucket: "anoraapp-ai.firebasestorage.app",
  messagingSenderId: "122353230600",
  appId: "1:122353230600:web:e5eff5c150fc1f200742bd",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

if (__DEV__) {
  const HOST = "192.168.178.141";

  // Auth Emulator
  try {
    connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
    console.log(`🔥 Auth Emulator verbunden (${HOST}:9099)`);
  } catch (e) {
    console.log("Auth Emulator vermutlich schon verbunden");
  }

  // Firestore Emulator
  try {
    connectFirestoreEmulator(db, HOST, 8080);
    console.log(`🔥 Firestore Emulator verbunden (${HOST}:8080)`);
  } catch (e) {
    console.log("Firestore Emulator vermutlich schon verbunden");
  }
}