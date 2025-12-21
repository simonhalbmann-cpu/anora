import { useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { auth } from "../services/firebase";

const HeaderMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace("/login");
    } catch (error) {
      console.log("Logout-Fehler:", error);
    } finally {
      setOpen(false);
    }
  };

  return (
    <View style={{ position: "relative" }}>
      {/* Burger-Icon */}
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      >
        <Text style={{ fontSize: 22, color: "white" }}>☰</Text>
      </Pressable>

      {/* Dropdown-Menü */}
      {open && (
        <View
          style={{
            position: "absolute",
            top: 36,
            right: 10,
            backgroundColor: "#111827",
            borderRadius: 8,
            paddingVertical: 4,
            minWidth: 160,
            borderWidth: 1,
            borderColor: "#374151",
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          {/* Einstellungen */}
          <Pressable
            onPress={() => {
              setOpen(false);
              router.push("/settings");
            }}
            style={{ paddingHorizontal: 14, paddingVertical: 10 }}
          >
            <Text style={{ color: "#e5e7eb", fontSize: 15 }}>
              Einstellungen
            </Text>
          </Pressable>

          {/* Trennlinie */}
          <View
            style={{
              height: 1,
              backgroundColor: "#1f2933",
              marginHorizontal: 8,
            }}
          />

          {/* Logout */}
          <Pressable
            onPress={handleLogout}
            style={{ paddingHorizontal: 14, paddingVertical: 10 }}
          >
            <Text style={{ color: "#f97373", fontSize: 15 }}>Logout</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

export default HeaderMenu;