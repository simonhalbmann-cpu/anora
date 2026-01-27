// app/register.tsx

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Eye, EyeOff } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../src/services/firebase";

export default function Register() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordRepeat, setShowPasswordRepeat] = useState(false);
  const [loading, setLoading] = useState(false);

  const validateDob = (value: string) => {
    const regex = /^\d{2}\.\d{2}\.\d{4}$/; // TT.MM.JJJJ
    return regex.test(value.trim());
  };

  const handleRegister = async () => {
    if (!firstName || !lastName || !dob || !email || !password || !passwordRepeat) {
      Alert.alert("Fehler", "Bitte fülle alle Pflichtfelder aus.");
      return;
    }

    if (!validateDob(dob)) {
      Alert.alert("Fehler", "Bitte gib das Geburtsdatum im Format TT.MM.JJJJ ein.");
      return;
    }

    if (password.length < 8) {
      Alert.alert("Fehler", "Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }

    if (password !== passwordRepeat) {
      Alert.alert("Fehler", "Die Passwörter stimmen nicht überein.");
      return;
    }

    try {
      setLoading(true);

      // 1) User in Auth anlegen
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = cred.user;

      // 2) Anzeigename in Firebase Auth setzen (Vorname + Nachname)
      const displayName = `${firstName} ${lastName}`.trim();
      await updateProfile(user, { displayName });

      // 3) Vorname lokal speichern – für Begrüßung im Home
      await AsyncStorage.setItem(
        "ANORA_CURRENT_FIRST_NAME",
        firstName.trim()
      );

      // 4) User-Daten + Personality in Firestore speichern (nicht UI-blockierend)
      (async () => {
        try {
          // Alles nach /profiles/{uid} (Rules erlauben das). Keine /users Collection.
const defaultPersonality = {
  coreVersion: 1,
  tone: {
    directness: 0.9,
    humor: 0.3,
    formality: 0.3,
    empathy: 0.8,
    emojiUsage: 0.1,
  },
  answerStyle: {
    length: "kurz",
    structure: "listen",
    explanations: "mittel",
  },
  behaviour: {
    askBeforeAssumptions: true,
    correctUserGently: true,
    proactiveHints: true,
  },
  updatedAt: Date.now(),
};

// Profil + Basisdaten in EIN Dokument schreiben
await setDoc(
  doc(db, "profiles", user.uid),
  {
    // Basis-Userdaten
    firstName,
    lastName,
    dob,
    email: email.trim().toLowerCase(),
    createdAt: serverTimestamp(),

    // Personality
    personality: defaultPersonality,
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);
        } catch (e) {
          console.log("Firestore user/profile write failed:", e);
        }
      })();

      // 5) Info + zurück zum Login
      Alert.alert("Erfolg", "Konto erstellt. Du kannst dich jetzt einloggen.", [
        {
          text: "OK",
          onPress: () => router.replace("/login"),
        },
      ]);
    } catch (e: any) {
      console.log("Register error:", e);
      Alert.alert(
        "Registrierung fehlgeschlagen",
        e?.message ?? "Bitte prüfe deine Eingaben oder versuche es später erneut."
      );
    } finally {
      setLoading(false);
    }
  };

  const goToLogin = () => {
    router.replace("/login");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={styles.logoBlock}>
          <Image
            source={require("../assets/logo-anora.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Konto erstellen</Text>
        </View>

        {/* Formular */}
        <View style={styles.form}>
          {/* Name + Nachname */}
          <View style={styles.row}>
            <View style={[styles.rowItem, { marginRight: 6 }]}>
              <Text style={styles.label}>
                Name <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                placeholder="Vorname"
                placeholderTextColor="#64748b"
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
              />
            </View>
            <View style={[styles.rowItem, { marginLeft: 6 }]}>
              <Text style={styles.label}>
                Nachname <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                placeholder="Nachname"
                placeholderTextColor="#64748b"
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
              />
            </View>
          </View>

          {/* Geburtsdatum */}
          <Text style={styles.label}>
            Geburtsdatum <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            placeholder="TT.MM.JJJJ"
            placeholderTextColor="#64748b"
            style={styles.input}
            value={dob}
            onChangeText={setDob}
          />

          {/* E-Mail */}
          <Text style={styles.label}>
            E-Mail <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            placeholder="E-Mail"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />

          {/* Passwort */}
          <Text style={styles.label}>
            Passwort <Text style={styles.required}>*</Text>
          </Text>
          <View style={styles.passwordWrapper}>
            <TextInput
              placeholder="Passwort (min. 8 Zeichen)"
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
                <EyeOff size={20} color="#94a3b8" />
              ) : (
                <Eye size={20} color="#94a3b8" />
              )}
            </TouchableOpacity>
          </View>

          {/* Passwort wiederholen */}
          <Text style={styles.label}>
            Passwort wiederholen <Text style={styles.required}>*</Text>
          </Text>
          <View style={styles.passwordWrapper}>
            <TextInput
              placeholder="Passwort wiederholen"
              placeholderTextColor="#64748b"
              secureTextEntry={!showPasswordRepeat}
              style={[styles.input, styles.passwordInput]}
              value={passwordRepeat}
              onChangeText={setPasswordRepeat}
            />
            <TouchableOpacity
              onPress={() => setShowPasswordRepeat((prev) => !prev)}
              style={styles.eyeButton}
              activeOpacity={0.7}
            >
              {showPasswordRepeat ? (
                <EyeOff size={20} color="#94a3b8" />
              ) : (
                <Eye size={20} color="#94a3b8" />
              )}
            </TouchableOpacity>
          </View>

          {/* Registrieren-Button */}
          <TouchableOpacity
            style={[styles.registerButton, loading && { opacity: 0.7 }]}
            activeOpacity={0.8}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.registerButtonText}>Registrieren</Text>
            )}
          </TouchableOpacity>

          {/* Link zu Login */}
          <Text style={styles.loginText}>
            Schon ein Konto?{" "}
            <Text style={styles.loginLink} onPress={goToLogin}>
              Anmelden
            </Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
    justifyContent: "center",
  },

  logoBlock: {
    alignItems: "center",
    marginBottom: 32,
  },
  logo: {
    width: 110,
    height: 110,
    marginBottom: 8,
  },
  title: {
    color: "#e5e7eb",
    fontSize: 20,
    fontWeight: "700",
  },

  form: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },

  label: {
    color: "#cbd5f5",
    fontSize: 13,
    marginBottom: 4,
  },

  required: {
    color: "#f97316",
    fontWeight: "700",
  },

  input: {
    width: "100%",
    backgroundColor: "#020617",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: "#e5e7eb",
    marginBottom: 14,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  rowItem: {
    flex: 1,
  },

  passwordWrapper: {
    position: "relative",
    width: "100%",
    marginBottom: 14,
  },

  passwordInput: {
    paddingRight: 44,
  },

  eyeButton: {
    position: "absolute",
    right: 14,
    top: "50%",
    marginTop: -10,
  },

  registerButton: {
    width: "100%",
    backgroundColor: "#0f9f9c",
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  registerButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },

  loginText: {
    textAlign: "center",
    marginTop: 18,
    color: "#cbd5f5",
    fontSize: 14,
  },

  loginLink: {
    color: "#22d3ee",
    fontWeight: "600",
  },
});