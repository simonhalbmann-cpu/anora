import { db } from "@/src/services/firebase";
import { getAuth } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

export async function writeProfileTest() {
  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) {
    console.log("❌ TEST: Kein eingeloggter User");
    return;
  }

  console.log("✅ TEST: User UID =", user.uid);

  await setDoc(
    doc(db, "profiles", user.uid),
    {
      testFromClient: true,
      writtenAt: serverTimestamp(),
    },
    { merge: true }
  );

  console.log("✅ TEST: setDoc erfolgreich");
}