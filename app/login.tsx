// app/login.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../src/services/firebase";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      Alert.alert("Hinweis", "Bitte E-Mail und Passwort eingeben.");
      return;
    }

    setLoading(true);

    try {
      // 1) Firebase Login
      const cred = await signInWithEmailAndPassword(
        auth,
        trimmedEmail,
        trimmedPassword
      );
      const user = cred.user;

      // 2) Versuchen, Vorname aus Firestore zu holen
      let firstName = "";

      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const data = snap.data() as any;
          firstName =
            (data.firstName as string) ||
            (data.firstname as string) ||
            "";
        }
      } catch (e) {
        console.log("Fehler beim Laden von firstName aus Firestore:", e);
      }

      // 3) Fallback: E-Mail-Localpart
      if (!firstName && user.email) {
        firstName = user.email.split("@")[0];
      }

      if (!firstName) {
        firstName = "Anora Nutzer";
      }

      // 4) Vorname lokal speichern, damit home.tsx ihn schnell laden kann
      try {
        await AsyncStorage.setItem("ANORA_CURRENT_FIRST_NAME", firstName);
      } catch (e) {
        console.log("Konnte ANORA_CURRENT_FIRST_NAME nicht speichern:", e);
      }

      // 5) Weiter zum Home-Screen
      router.replace("/home");
    } catch (err: any) {
      console.log("Login-Fehler:", err);
      let msg = "Login fehlgeschlagen. Bitte prüfe deine Eingaben.";

      if (err.code === "auth/invalid-email") msg = "Ungültige E-Mail-Adresse.";
      if (err.code === "auth/user-not-found")
        msg = "Kein Benutzer mit dieser E-Mail gefunden.";
      if (err.code === "auth/wrong-password")
        msg = "Falsches Passwort.";
      if (err.code === "auth/too-many-requests")
        msg =
          "Zu viele Versuche. Bitte warte kurz und versuche es später erneut.";

      Alert.alert("Fehler", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoToRegister = () => {
    router.push("/register");
  };

  const handleForgotPassword = () => {
    router.push("/forgot-password");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 20}
    >
      {/* Logo + Claim */}
      <View style={styles.logoBlock}>
        <Image
          source={require("../assets/logo-anora.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.claim}>Dein zweites Gehirn – privat & lokal</Text>
      </View>

      {/* Formular */}
      <View style={styles.form}>
        {/* E-Mail */}
        <TextInput
          placeholder="E-Mail"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />

        {/* Passwort + Auge */}
        <View style={styles.passwordWrapper}>
          <TextInput
            placeholder="Passwort"
            placeholderTextColor="#64748b"
            secureTextEntry={!showPassword}
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity
            onPress={() => setShowPassword((prev) => !prev)}
            style={styles.eyeButton}
            activeOpacity={0.7}
          >
            {showPassword ? (
              <EyeOff size={22} color="#94a3b8" />
            ) : (
              <Eye size={22} color="#94a3b8" />
            )}
          </TouchableOpacity>
        </View>

        {/* Passwort vergessen */}
        <TouchableOpacity
          onPress={handleForgotPassword}
          style={styles.forgotButton}
        >
          <Text style={styles.forgotText}>Passwort vergessen?</Text>
        </TouchableOpacity>

        {/* Login-Button */}
        <TouchableOpacity
          style={[styles.loginButton, loading && { opacity: 0.6 }]}
          activeOpacity={0.8}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.loginButtonText}>Anmelden</Text>
          )}
        </TouchableOpacity>

        {/* Registrierung */}
        <Text style={styles.registerText}>
          Noch kein Konto?{" "}
          <Text style={styles.registerLink} onPress={handleGoToRegister}>
            Registrieren
          </Text>
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  logoBlock: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 8,
  },
  claim: {
    textAlign: "center",
    fontSize: 15,
    fontWeight: "500",
    color: "#e5e7eb",
  },
  form: {
    width: "100%",
    maxWidth: 380,
  },
  input: {
    width: "100%",
    backgroundColor: "#020617",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#e5e7eb",
    marginBottom: 14,
  },
  passwordWrapper: {
    position: "relative",
    width: "100%",
    marginBottom: 8,
  },
  passwordInput: {
    paddingRight: 46,
  },
  eyeButton: {
    position: "absolute",
    right: 14,
    top: "50%",
    marginTop: -11,
  },
  forgotButton: {
    alignSelf: "flex-end",
    marginBottom: 16,
  },
  forgotText: {
    color: "#38bdf8",
    fontSize: 13,
  },
  loginButton: {
    width: "100%",
    backgroundColor: "#0f9f9c",
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  loginButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  registerText: {
    textAlign: "center",
    marginTop: 18,
    color: "#cbd5f5",
    fontSize: 14,
  },
  registerLink: {
    color: "#22d3ee",
    fontWeight: "600",
  },
});
