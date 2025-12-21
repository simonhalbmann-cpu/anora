// src/services/firebase.ts

import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import {
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 🔴 HIER deine NEUE Config aus dem Projekt "anoraapp-ai" einfügen
const firebaseConfig = {
  apiKey: "AIzaSyDyJIUYVaO3RpWVIN9BLS8diNrcdDzuHD4",
  authDomain: "anoraapp-ai.firebaseapp.com",
  projectId: "anoraapp-ai",
  storageBucket: "anoraapp-ai.firebasestorage.app",
  messagingSenderId: "122353230600",
  appId: "1:122353230600:web:e5eff5c150fc1f200742bd",
};

const app = initializeApp(firebaseConfig);

// persistenter Login
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});

export const db = getFirestore(app);
