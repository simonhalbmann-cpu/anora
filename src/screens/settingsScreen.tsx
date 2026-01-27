// src/screens/settingsScreen.tsx
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text
} from "react-native";
import {
  apiResetUserKnowledge,
  apiResetUserPersonality,
} from "../services/anoraAdmin";
import { auth } from "../services/firebase";
import { apiSetPresenceEnabled } from "../services/presenceSettingsApi";
import {
  apiGetPresenceTopics,
  apiSetPresenceTopicMuted,
  PresenceTopicKey,
  PresenceTopicsMap,
} from "../services/presenceTopicsApi";

const TOPIC_LABELS: Record<
  PresenceTopicKey,
  { title: string; description: string }
> = {
  stress_cluster: {
    title: "Stress & Konflikt-Cluster",
    description:
      "Hinweise, wenn sich viele stressige oder konfliktgeladene Themen sammeln.",
  },
  money_decision: {
    title: "Geld- & Finanzentscheidungen",
    description:
      "Hinweise zu größeren Kauf-/Verkaufs- oder Finanzierungsentscheidungen.",
  },
  project_followup: {
    title: "Projekte & offene Aufgaben",
    description:
      "Nudges zu offenen To-dos, manuellen Risiko-Checks oder laufenden Projekten.",
  },
  location_watch: {
    title: "Ortsbeobachtung",
    description:
      "Hinweise zu riskanten Orten, Brennpunkten oder Bereichen, die du im Blick behalten willst.",
  },
  other: {
    title: "Sonstige Hinweise",
    description:
      "Generische Presence-Hinweise, die sonst in kein anderes Thema fallen.",
  },
};

export default function SettingsScreen() {
  const [loading, setLoading] = useState<
    null | "knowledge" | "personality" | "presenceOn" | "presenceOff"
  >(null);
  const [topics, setTopics] = useState<PresenceTopicsMap | null>(null);
  const [topicsLoading, setTopicsLoading] = useState<boolean>(false);
  const [topicActionKey, setTopicActionKey] = useState<PresenceTopicKey | null>(
    null
  );

  function getCurrentUserId(): string | null {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Fehler", "Du bist nicht eingeloggt.");
      return null;
    }
    return user.uid;
  }

  async function loadPresenceTopicsForCurrentUser() {
    const user = auth.currentUser;
    if (!user) {
      // Kein Alert hier – Screen kann auch angezeigt werden, bevor Auth fertig ist.
      console.log("loadPresenceTopics: no current user");
      return;
    }

    try {
      setTopicsLoading(true);
      const res = await apiGetPresenceTopics();
      setTopics(res.topics || {});
    } catch (e) {
      console.log("loadPresenceTopics error", e);
      // kein Alert nötig, die Presence-Section ist optional
    } finally {
      setTopicsLoading(false);
    }
  }

  useEffect(() => {
    loadPresenceTopicsForCurrentUser();
  }, []);

  // Wissen zurücksetzen (Panic-Reset, nur für diesen User)
  const handleResetKnowledge = () => {
    const userId = getCurrentUserId();
    if (!userId) return;

    Alert.alert(
      "Wissen wirklich löschen?",
      "Anoras gesamtes gespeichertes Wissen über dich (Fakten, Mieter, Dokumente etc.) wird gelöscht. Das lässt sich nicht rückgängig machen.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Ja, löschen",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading("knowledge");
              await apiResetUserKnowledge(userId);
              Alert.alert(
                "Fertig",
                "Anoras Wissen über dich wurde vollständig gelöscht."
              );
            } catch (e) {
              console.log("resetUserKnowledge error", e);
              Alert.alert(
                "Fehler",
                "Wissen konnte nicht zurückgesetzt werden. Versuch es später erneut."
              );
            } finally {
              setLoading(null);
            }
          },
        },
      ]
    );
  };

  // Persönlichkeit zurücksetzen (meta/personality)
  const handleResetPersonality = () => {
    const userId = getCurrentUserId();
    if (!userId) return;

    Alert.alert(
      "Persönlichkeit zurücksetzen?",
      "Anoras gelernte Persönlichkeit / Feineinstellungen für dich werden gelöscht. Dein Sachwissen (Mieter, Objekte, Dokumente) bleibt erhalten.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Zurücksetzen",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading("personality");
              await apiResetUserPersonality(userId);
              Alert.alert(
                "Okay",
                "Anoras Persönlichkeit für dich wurde zurückgesetzt."
              );
            } catch (e) {
              console.log("resetUserPersonality error", e);
              Alert.alert(
                "Fehler",
                "Persönlichkeit konnte nicht zurückgesetzt werden. Versuch es später erneut."
              );
            } finally {
              setLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleEnablePresence = () => {
    const userId = getCurrentUserId();
    if (!userId) return;

    Alert.alert(
      "Presence aktivieren?",
      "Anora darf dir dann wieder gelegentlich Presence-Karten im Chat einblenden. Das sind kurze, sachliche Hinweise zu Entscheidungen, Stress-Themen oder offenen Aufgaben - ohne Autohandlungen und ohne Smalltalk",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Aktivieren",
          onPress: async () => {
            try {
              setLoading("presenceOn");
              await apiSetPresenceEnabled(true);
              Alert.alert("Okay", "Presence ist für dich jetzt aktiviert.");
            } catch (e) {
              console.log("enablePresence error", e);
              Alert.alert(
                "Fehler",
                "Presence konnte nicht aktiviert werden. Versuch es später erneut."
              );
            } finally {
              setLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleDisablePresence = () => {
    const userId = getCurrentUserId();
    if (!userId) return;

    Alert.alert(
      "Presence deaktivieren?",
      "Anora zeigt dir dann keine Presence-Karten mehr im Chat an. Du bekommst weiterhin normale Antworten im Chat, aber keine zusätzlichen Hinweise zu Stress, Entscheidungen oder offenen Themen",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Deaktivieren",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading("presenceOff");
              await apiSetPresenceEnabled(false);
              Alert.alert("Okay", "Presence ist für dich jetzt deaktiviert.");
            } catch (e) {
              console.log("disablePresence error", e);
              Alert.alert(
                "Fehler",
                "Presence konnte nicht deaktiviert werden. Versuch es später erneut."
              );
            } finally {
              setLoading(null);
            }
          },
        },
      ]
    );
  };

const handleTogglePresenceTopic = (topic: PresenceTopicKey) => {
    const userId = getCurrentUserId();
    if (!userId) return;

    const now = Date.now();
    const current = topics?.[topic];

    const isMuted =
  !!current &&
  typeof current.lastDisabledAt === "number" &&
  current.lastDisabledAt > 0;

    const nextMuted = !isMuted;

    setTopicActionKey(topic);

    apiSetPresenceTopicMuted(topic, nextMuted)
      .then((res) => {
        setTopics(res.topics || {});
      })
      .catch((e) => {
        console.log("handleTogglePresenceTopic error", e);
        Alert.alert(
          "Fehler",
          "Presence-Thema konnte nicht aktualisiert werden. Versuch es später erneut."
        );
      })
      .finally(() => {
        setTopicActionKey(null);
      });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>Einstellungen</Text>

      <Text style={styles.sectionTitle}>Daten & Verhalten</Text>

      {/* Wissen zurücksetzen */}
      <Pressable
        onPress={handleResetKnowledge}
        disabled={loading !== null}
        style={[
          styles.button,
          { borderColor: "#f97373" },
          loading === "knowledge" && { opacity: 0.6 },
        ]}
      >
        {loading === "knowledge" ? (
          <ActivityIndicator color="#f97373" />
        ) : (
          <Text style={styles.buttonText}>Anoras Wissen zurücksetzen</Text>
        )}
      </Pressable>

      <Text style={styles.helperText}>
        Löscht alle Fakten zu deinen Objekten, Mietern, Terminen, Dokumenten
        usw. Nur dein Login bleibt erhalten.
      </Text>

      {/* Persönlichkeit zurücksetzen */}
      <Pressable
        onPress={handleResetPersonality}
        disabled={loading !== null}
        style={[
          styles.button,
          { borderColor: "#38bdf8" },
          loading === "personality" && { opacity: 0.6 },
        ]}
      >
        {loading === "personality" ? (
          <ActivityIndicator color="#38bdf8" />
        ) : (
          <Text style={styles.buttonText}>
            Anoras Persönlichkeit zurücksetzen
          </Text>
        )}
      </Pressable>

      <Text style={styles.helperText}>
        Setzt spätere Feineinstellungen von Anoras Verhalten für dich zurück.
        Sachwissen bleibt unverändert.
      </Text>

      <Text style={styles.sectionTitle}>Presence</Text>

      {/* Presence aktivieren */}
      <Pressable
        onPress={handleEnablePresence}
        disabled={loading !== null}
        style={[
          styles.button,
          { borderColor: "#22c55e" },
          loading === "presenceOn" && { opacity: 0.6 },
        ]}
      >
        {loading === "presenceOn" ? (
          <ActivityIndicator color="#22c55e" />
        ) : (
          <Text style={styles.buttonText}>Presence aktivieren</Text>
        )}
      </Pressable>

      {/* Presence deaktivieren */}
      <Pressable
        onPress={handleDisablePresence}
        disabled={loading !== null}
        style={[
          styles.button,
          { borderColor: "#64748b" },
          loading === "presenceOff" && { opacity: 0.6 },
        ]}
      >
        {loading === "presenceOff" ? (
          <ActivityIndicator color="#64748b" />
        ) : (
          <Text style={styles.buttonText}>Presence deaktivieren</Text>
        )}
      </Pressable>

      <Text style={styles.helperText}>
        Presence sind seltene, sachliche Hinweise im Chat – zum Beispiel zu
        Stress-Clustern, wichtigen Geldentscheidungen oder offenen Aufgaben.
        Anora führt dabei nichts automatisch aus, sondern macht dich nur auf
        Themen aufmerksam. Du kannst Presence hier jederzeit ein- oder
        ausschalten.
      </Text>

      <Text style={styles.sectionTitle}>Presence-Themen</Text>

      {topicsLoading && (
        <ActivityIndicator
          style={{ marginBottom: 12 }}
          color="#38bdf8"
        />
      )}

      {Object.entries(TOPIC_LABELS).map(([key, meta]) => {
        const topicKey = key as PresenceTopicKey;
        const topicState = topics?.[topicKey];
        const now = Date.now();

        const isMuted =
  !!topicState &&
  typeof topicState.lastDisabledAt === "number" &&
  topicState.lastDisabledAt > 0;

        return (
          <Pressable
            key={topicKey}
            onPress={() => handleTogglePresenceTopic(topicKey)}
            disabled={topicActionKey === topicKey}
            style={[
              styles.topicCard,
              isMuted && styles.topicCardMuted,
            ]}
          >
            <Text style={styles.topicTitle}>{meta.title}</Text>
            <Text style={styles.topicDescription}>
              {meta.description}
            </Text>
            <Text
              style={[
                styles.topicStatus,
                isMuted
                  ? styles.topicStatusMuted
                  : styles.topicStatusActive,
              ]}
            >
              {isMuted ? "Hinweise pausiert" : "Hinweise aktiv"}
            </Text>

            {topicActionKey === topicKey && (
              <ActivityIndicator
                style={{ marginTop: 8 }}
              />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
  },
  content: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40, // damit du ganz unten sauber scrollen kannst
  },
  title: {
    color: "#e5e7eb",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 24,
  },
  sectionTitle: {
    color: "#9ca3af",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  button: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  buttonText: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "600",
  },
  helperText: {
    color: "#6b7280",
    fontSize: 13,
    marginTop: 6,
    marginBottom: 14,
  },
  topicCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: 4,
    borderColor: "#1f2933",
    backgroundColor: "#020617",
  },
  topicCardMuted: {
    borderColor: "#4b5563",
    backgroundColor: "#020617",
    opacity: 0.7,
  },
  topicTitle: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  topicDescription: {
    color: "#9ca3af",
    fontSize: 13,
    marginBottom: 8,
  },
  topicStatus: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  topicStatusActive: {
    color: "#22c55e",
  },
  topicStatusMuted: {
    color: "#f97373",
  },
});