import React from "react";
import { View, Text, Pressable } from "react-native";

export default function PingTest() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 12 }}>
      <Pressable
        onPress={async () => {
          try {
            const r = await fetch("http://192.168.1.18:3333/ping");
            const j = await r.json();
            console.log("PING OK:", j);
          } catch (e) {
            console.log("PING FAIL:", e);
          }
        }}
        style={{ padding: 14, borderWidth: 1, borderRadius: 12 }}
      >
        <Text>Tester connexion PC</Text>
      </Pressable>

      <Text>Regarde la console Expo</Text>
    </View>
  );
}
