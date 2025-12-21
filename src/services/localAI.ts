import AsyncStorage from "@react-native-async-storage/async-storage";

// ⚠️ Lokaler Demo-Speicher für Ask/Teach.
// Nutzt NUR AsyncStorage auf diesem Gerät.
// Hat NICHTS mit dem echten Anora-Brain (Firestore / Functions / anoraChat) zu tun.

const KEY = "anora_qa_v1";

export async function getAnswer(question: string) {
  const raw = await AsyncStorage.getItem(KEY);
  const qa = raw ? JSON.parse(raw) : {};
  return qa[question.trim()] || "Keine Antwort gefunden.";
}

export async function teachAnswer(question: string, answer: string) {
  const raw = await AsyncStorage.getItem(KEY);
  const qa = raw ? JSON.parse(raw) : {};
  qa[question.trim()] = answer.trim();
  await AsyncStorage.setItem(KEY, JSON.stringify(qa));
}
