// app/home.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { Mic, Plus, Send } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
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
import HeaderMenu from "../src/components/HeaderMenu";
import NeuralBackground from "../src/components/NeuralBackground";
import { auth, db } from "../src/services/firebase";

// ------------------------------------------------------------------
// Konfiguration
// ------------------------------------------------------------------
const ANORA_BASE_URL =
  "http://192.168.178.141:5001/anoraapp-ai/us-central1/api";

  async function getAuthHeader(): Promise<Record<string, string>> {
  const u = auth.currentUser;
  if (!u) return {};
  const token = await u.getIdToken(true); 
  return { Authorization: `Bearer ${token}` };
}

// ------------------------------------------------------------------
// Typen
// ------------------------------------------------------------------
type MessageMode = "ask" | "teach";

type Message = {
  id: string;
  role: "user" | "anora";
  text: string;
  mode: MessageMode;
};

type PresenceEvent = {
  id: string;
  type: "project_nudging" | "decision_followup" | "stress_hint" | "generic";
  message: string;
  createdAt: number;
  source?: string;
  linkedTaskId?: string | null;
  status?: string;
};

type DigestBlock = {
  id: string;
  title?: string; // Backend liefert default "Zusammenfassung" (UI kann ignorieren)
  message: string;
  createdAt: number;
  source?: string;
  status?: string;
};

type PresenceResponseV2 = {
  ok: true;
  digest?: DigestBlock | null;
  presence?: PresenceEvent | null;
};

// ------------------------------------------------------------------
// Presence-Fetcher: holt Event + fügt die ID korrekt hinzu
// ------------------------------------------------------------------
async function fetchPresence(): Promise<{
  digest: DigestBlock | null;
  presence: PresenceEvent | null;
}> {
  try {
    const authHeader = await getAuthHeader();
if (!authHeader.Authorization) return { digest: null, presence: null };


    const response = await fetch(`${ANORA_BASE_URL}/anoraPresence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({}), // leer lassen
    });

    if (response.status === 204) {
      console.log("anoraPresence: kein Digest/Presence (204)");
      return { digest: null, presence: null };
    }

    if (!response.ok) {
      console.log("anoraPresence-Fehlerstatus:", response.status);
      return { digest: null, presence: null };
    }

    const data = (await response.json()) as PresenceResponseV2;
    return { digest: data?.digest ?? null, presence: data?.presence ?? null };
  } catch (e) {
    console.log("Fehler beim Abruf von anoraPresence:", e);
    return { digest: null, presence: null };
  }
}

// ------------------------------------------------------------------
// Hilfsfunktionen
// ------------------------------------------------------------------
function inferMode(text: string): MessageMode {
  const t = text.trim().toLowerCase();
  if (!t) return "ask";
  if (t.endsWith("?")) return "ask";

  const qWords = [
    "wer ",
    "was ",
    "wann ",
    "wie ",
    "wieso ",
    "warum ",
    "welche ",
    "welcher ",
    "welches ",
  ];

  if (qWords.some((w) => t.startsWith(w))) return "ask";

  return "teach";
}

let _printedTokenOnce = false;

async function debugPrintIdTokenOnce() {
  if (_printedTokenOnce) return;
  _printedTokenOnce = true;

  try {
    const u = auth.currentUser;
    if (!u) {
      console.log("ID_TOKEN: no currentUser yet");
      return;
    }
    const t = await getIdToken(u, true);
    console.log("ID_TOKEN:", t);
  } catch (e) {
    console.log("ID_TOKEN error:", e);
  }
}

// ------------------------------------------------------------------
// Hauptkomponente
// ------------------------------------------------------------------
export default function HomeScreen() {
  const router = useRouter();

  const [userName, setUserName] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [brainFacts, setBrainFacts] = useState<any[]>([]);
  const [sending, setSending] = useState(false);

  const [presenceDigest, setPresenceDigest] = useState<DigestBlock | null>(null);
  const [presenceEvent, setPresenceEvent] = useState<PresenceEvent | null>(null);

  const scrollViewRef = useRef<ScrollView | null>(null);

  // Presence beim App-Start einmalig laden
  useEffect(() => {
    if (checkingAuth) return;

    const currentUser = auth.currentUser;
    if (!currentUser) return;

    console.log("Presence: initial load");
loadPresence();

// ✅ Brain Facts laden (einmalig nach Login)
  loadFactsForUser(currentUser.uid);


// optional für Debug 1x Token ausgeben:
debugPrintIdTokenOnce();

  }, [checkingAuth]);

  // Auth prüfen und Vorname aus AsyncStorage laden
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const run = async () => {
        if (!user) {
          setCheckingAuth(false);
          router.replace("/login");
          return;
        }

        try {
          const storedName = await AsyncStorage.getItem(
            "ANORA_CURRENT_FIRST_NAME"
          );

          if (storedName && storedName.trim().length > 0) {
            setUserName(storedName.trim());
          } else {
            setUserName("Anora Nutzer");
          }
        } catch (e) {
          console.log("Fehler beim Laden des gespeicherten Namens:", e);
          setUserName("Anora Nutzer");
        } finally {
          setCheckingAuth(false);
        }
      };

      run();
    });

    return () => unsubscribe();
  }, [router]);

  // Willkommensnachricht
  useEffect(() => {
    if (checkingAuth) return;
    if (!userName) return;
    if (messages.length > 0) return;

    const welcome: Message = {
      id: "welcome-1",
      role: "anora",
      mode: "ask",
      text:
        `Hey ${userName} 👋\n` +
        "Ich laufe im Hintergrund mit und lerne dich mit der Zeit besser kennen.\n" +
        "Hier kannst du mir Fragen stellen oder mir Infos, Bilder und Dateien geben.",
    };

    setMessages([welcome]);
  }, [checkingAuth, userName, messages.length]);

  // Immer ans Ende scrollen, wenn neue Nachrichten kommen
  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  async function loadFactsForUser(uid: string) {
  try {
    const colRef = collection(db, "brain", uid, "facts");
    const qy = query(colRef, limit(200)); // fürs Debug erstmal begrenzen
    const snap = await getDocs(qy);

    const factsRaw: any[] = [];
snap.forEach((d) => factsRaw.push(d.data()));

// ✅ aktiv-only: isSuperseded !== true (false oder undefined gilt als aktiv)
const factsActive = factsRaw.filter((x) => x && x.isSuperseded !== true);

setBrainFacts(factsActive);
console.log("Loaded brain facts (active):", factsActive.length);

  } catch (e) {
    console.log("Fehler beim Laden brain facts:", e);
    setBrainFacts([]);
  }
}

  async function loadPresence() {
  try {
    const out = await fetchPresence();
    setPresenceDigest(out.digest);
    setPresenceEvent(out.presence);
  } catch (err) {
    console.log("Fehler beim Laden von Presence:", err);
  }
}

  type PresenceAction = "view_now" | "snooze" | "disable";

  async function handlePresenceAction(action: PresenceAction) {
    if (!presenceEvent) return;

    // 1) passende Chat-Nachricht vorbereiten
    let followupText: string | null = null;

    switch (action) {
      case "view_now":
        followupText =
          "Okay, dann lass uns dieses Thema jetzt sortieren. " +
          "Schreib mir kurz, womit du anfangen willst.";
        break;

      case "snooze":
        followupText =
          "Alles klar, ich schiebe diesen Hinweis erstmal nach hinten. " +
          "Wenn du soweit bist, sag mir einfach Bescheid.";
        break;

      case "disable":
        followupText =
          "Verstanden – Ich blende dieses Thema erstmal aus. Wenn es später wieder relevant wird oder du im Chat wieder darüber sprichst, können wir es erneut aufnehmen.";
        break;
    }

    // 2) Chat-Bubble anhängen (falls Text definiert)
    if (followupText) {
      const anoraPresenceMessage: Message = {
        id: Date.now().toString() + "-presence",
        role: "anora",
        mode: "ask",
        text: followupText,
      };

      setMessages((prev) => [...prev, anoraPresenceMessage]);
    }

    // 3) Karte im UI ausblenden
    const eventId = presenceEvent.id;
    setPresenceEvent(null);

    // 4) Backend informieren (AUTH-only, KEIN userId)
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) {
        console.log("PresenceAction: not authenticated");
        return;
      }

      await fetch(`${ANORA_BASE_URL}/anoraPresenceAction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({ eventId, action }), // userId bewusst NICHT senden
      });

      // danach Presence neu laden
      await loadPresence();
    } catch (e) {
      console.log("Fehler bei handlePresenceAction:", e);
    }
  }

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const mode = inferMode(trimmed);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      text: trimmed,
      mode,
    };

    const historyPayload = [...messages, userMessage]
      .slice(-10)
      .map((m) => ({
        role: m.role,
        text: m.text,
      }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const currentUser = auth.currentUser;
      const userId = currentUser?.uid ?? "unknown-user";

console.log("handleSend payload:", {
        userId,
        userName,
        message: trimmed,
        history: historyPayload,
      });

// 🔀 DEV-Shortcut: "zeige fakten" direkt aus dem Client beantworten (ohne Backend)
// Schlank: nur latest + dedupe nach (key + entityId)
if (/^\s*(zeige|zeig)\s+(mir\s+)?(deine\s+)?(gespeicherten\s+)?fakten\s*\.?\s*$/i.test(trimmed)) {
  const list = Array.isArray(brainFacts) ? brainFacts : [];

  // 1) nur latest (falls meta vorhanden)
  const latestOnly = list.filter((f: any) => f?.meta?.latest === true);

  // 2) dedupe: key + entityId
  const seen = new Set<string>();
  const deduped = latestOnly.filter((f: any) => {
    const key = String(f?.key ?? "?");
    const entityId = String(f?.entityId ?? "");
    const sig = `${key}::${entityId}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  const factsText =
    deduped.length > 0
      ? deduped
          .map((f: any) => {
            const key = String(f?.key ?? "?");
            const entityId = f?.entityId ? ` (${String(f.entityId)})` : "";
            return `- ${key}${entityId}: ${JSON.stringify(f?.value ?? null)}`;
          })
          .join("\n")
      : "Keine latest Facts im Client-State.";

  const anoraMessage: Message = {
    id: Date.now().toString() + "-anora-facts",
    role: "anora",
    mode,
    text: `Aktueller Client-State (brainFacts, latest+deduped):\n${factsText}`,
  };

  setMessages((prev) => [...prev, anoraMessage]);
  setSending(false);

console.log("brainFacts[0] sample:", (Array.isArray(brainFacts) ? brainFacts[0] : null));

  return;
}

      const response = await fetch(`${ANORA_BASE_URL}/anoraChat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
  userId,
  userName,
  message: trimmed,
  useSatellite: true,

  brain: {
    history: historyPayload,
    knowledge: [],
    contexts: null,
  },

  state: { locale: "de-DE", facts: brainFacts },

  // 🔴 HIER
  dryRun: false,
}),
});

      if (!response.ok) {
        console.log("Backend-Fehlerstatus:", response.status);
        const errorMessage =
          response.status === 429
            ? "Mein KI-Gehirn ist kurz überlastet. Versuch es gleich nochmal."
            : "Beim Zugriff auf mein KI-Gehirn gab es einen technischen Fehler.";

        const fallbackMessage: Message = {
          id: Date.now().toString() + "-error",
          role: "anora",
          mode: "ask",
          text: errorMessage,
        };

        setMessages((prev) => [...prev, fallbackMessage]);
        return;
      }

      const data = await response.json();

      // ✅ nach Write: Facts erneut ziehen (damit UI/State nicht stale ist)
if (currentUser?.uid) {
  loadFactsForUser(currentUser.uid);
}

      const replyText =
        typeof data.reply === "string" && data.reply.trim().length > 0
          ? data.reply.trim()
          : "Ich habe deine Nachricht bekommen, aber konnte gerade nicht sinnvoll antworten.";

      const anoraMessage: Message = {
        id: Date.now().toString() + "-anora",
        role: "anora",
        text: replyText,
        mode,
      };

      setMessages((prev) => [...prev, anoraMessage]);

      // Presence-Reload ist aktuell deaktiviert (loadPresenceForUser existiert nicht)
if (currentUser?.uid) {
  console.log("Presence reload skipped: loadPresenceForUser not wired yet");
}
    } catch (e) {
      console.log("Fehler beim Senden an anoraChat:", e);
      const errorMessage: Message = {
        id: Date.now().toString() + "-network-error",
        role: "anora",
        mode: "ask",
        text:
          "Beim Zugriff auf mein KI-Gehirn gab es ein Netzwerkproblem. Prüf bitte deine Verbindung und versuch es nochmal.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
    }
  };

  const handleAttach = () => {
    Alert.alert(
      "Anhängen",
      "Hier kannst du später Bilder & Dateien an Anora schicken."
    );
  };

  const handleMic = () => {
    Alert.alert("Mikrofon", "Sprachfunktion (Ein-/Ausgabe) kommt später.");
  };

  if (checkingAuth || !userName) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator size="large" color="#0f9f9c" />
      </View>
    );
  }

  const hasDigest = !!presenceDigest?.message?.trim();
  const hasPresence = !!presenceEvent?.message?.trim();

  const cardTitle = hasDigest && hasPresence
    ? "Übersicht + Offenes Thema"
    : hasPresence
      ? "Offenes Thema"
      : "Kurzüberblick";

  return (
  <View style={styles.container}>
    <NeuralBackground />

    <KeyboardAvoidingView
      style={StyleSheet.absoluteFill}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 20}
    >
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require("../assets/logo-anora.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={styles.headerRight}>
          <HeaderMenu />
        </View>
      </View>

      {/* Scrollbarer Chat-Bereich */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Presence-Karte */}
        {(presenceDigest || presenceEvent) && (
  <View style={styles.presenceCard}>
    <Text style={styles.presenceTitle}>{cardTitle}</Text>

    {/* DIGEST-SECTION */}
    {presenceDigest && (
      <View style={styles.digestSection}>
        <Text style={styles.digestHeader}>Kurzüberblick</Text>
        <Text style={styles.digestText}>{presenceDigest.message}</Text>
      </View>
    )}

    {/* PRESENCE-SECTION */}
    {presenceEvent && (
      <View style={styles.presenceSection}>
        <Text style={styles.presenceHeader}>Offenes Thema</Text>
        <Text style={styles.presenceMessage}>{presenceEvent.message}</Text>

        <View style={styles.presenceButtonsRow}>
          <TouchableOpacity
            style={[styles.presenceButton, styles.presenceButtonPrimary]}
            onPress={() => handlePresenceAction("view_now")}
          >
            <Text style={styles.presenceButtonPrimaryText}>Jetzt ansehen</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.presenceButton, styles.presenceButtonSecondary]}
            onPress={() => handlePresenceAction("snooze")}
          >
            <Text style={styles.presenceButtonSecondaryText}>Später</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.presenceButton, styles.presenceButtonSecondary]}
            onPress={() => handlePresenceAction("disable")}
          >
            <Text style={styles.presenceButtonSecondaryText}>Ausblenden</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}
  </View>
)}

        {/* Normale Chat-Nachrichten */}
        {messages.map((item) => {
          const isUser = item.role === "user";
          const isTeach = item.mode === "teach";

          return (
            <View
              key={item.id}
              style={[
                styles.messageRow,
                isUser ? styles.messageRowUser : styles.messageRowAnora,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  isUser ? styles.bubbleUser : styles.bubbleAnora,
                  isTeach && styles.bubbleTeach,
                ]}
              >
                <Text style={styles.bubbleSender}>
                  {isUser ? "Du" : "Anora"}
                  {isTeach ? " • Wissen" : ""}
                </Text>
                <Text style={styles.bubbleText}>{item.text}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Eingabe-Bereich */}
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.iconButton} onPress={handleAttach}>
          <Plus size={24} color="#94a3b8" />
        </TouchableOpacity>

        <TextInput
          style={styles.textInput}
          placeholder="Nachricht an Anora…"
          placeholderTextColor="#64748b"
          value={input}
          onChangeText={setInput}
          multiline
        />

        <TouchableOpacity style={styles.iconButton} onPress={handleMic}>
          <Mic size={24} color="#94a3b8" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconButton, (!input.trim() || sending) && { opacity: 0.3 }]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          {sending ? <ActivityIndicator size="small" /> : <Send size={24} color="#0f9f9c" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  </View>
);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617" },

  header: {
    paddingTop: 50,
    paddingBottom: 26,
    alignItems: "center",
    justifyContent: "center",
  },

  logo: { width: 110, height: 110 },

  headerRight: {
    position: "absolute",
    right: 20,
    top: 60,
  },

  chatArea: { flex: 1 },

  messagesContent: { padding: 16 },

  messageRow: { marginBottom: 10, flexDirection: "row" },
  messageRowUser: { justifyContent: "flex-end" },
  messageRowAnora: { justifyContent: "flex-start" },

  bubble: {
    maxWidth: "80%",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleUser: { backgroundColor: "#0f9f9c" },
  bubbleAnora: {
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  bubbleTeach: { borderColor: "#22c55e" },

  bubbleSender: {
    fontSize: 11,
    color: "#cbd5f5",
    marginBottom: 2,
    opacity: 0.8,
  },

  bubbleText: { fontSize: 15, color: "#e5e7eb" },

  presenceCard: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  presenceTitle: {
    fontSize: 11,
    color: "#bbf7d0",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  presenceMessage: {
    fontSize: 14,
    color: "#e5e7eb",
  },
  presenceButtonsRow: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
  },
  presenceButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#22c55e",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020617",
  },
  presenceButtonPrimary: {
    backgroundColor: "#22c55e33",
  },
  presenceButtonSecondary: {},
  presenceButtonPrimaryText: {
    fontSize: 12,
    color: "#22c55e",
    fontWeight: "600",
  },
  presenceButtonSecondaryText: {
    fontSize: 12,
    color: "#bbf7d0",
  },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    marginBottom: 4,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },

  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020617",
  },

  textInput: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#e5e7eb",
    fontSize: 15,
  },

  presenceSubtitle: {
  fontSize: 11,
  color: "#9ca3af",
  marginBottom: 6,
},

digestSection: {
  marginTop: 6,
  marginBottom: 10,
  paddingBottom: 10,
  borderBottomWidth: 1,
  borderBottomColor: "#1e293b",
},
digestHeader: {
  fontSize: 12,
  color: "#93c5fd",
  marginBottom: 6,
  fontWeight: "600",
},
digestText: {
  fontSize: 13,
  color: "#e5e7eb",
  opacity: 0.95,
  lineHeight: 18,
},

presenceSection: {
  marginTop: 6,
},
presenceHeader: {
  fontSize: 12,
  color: "#bbf7d0",
  marginBottom: 6,
  fontWeight: "600",
},
});