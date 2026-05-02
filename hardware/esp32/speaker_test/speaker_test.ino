void setup() {
  Serial.begin(115200);
  pinMode(46, OUTPUT);
  Serial.println("Hoparlor Testi Basliyor...");
}

void loop() {
  Serial.println("Bip: 1000Hz (1 saniye)");
  tone(46, 1000);
  delay(1000);
  
  Serial.println("Sessiz (1 saniye)");
  noTone(46);
  delay(1000);

  Serial.println("Bip: 2000Hz (1 saniye)");
  tone(46, 2000);
  delay(1000);
  
  Serial.println("Sessiz (1 saniye)");
  noTone(46);
  delay(2000);
}
