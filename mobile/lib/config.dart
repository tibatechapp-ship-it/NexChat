class Config {
  static const String apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'http://10.0.2.2:3000',
  );
  static const int maxFileSize = 30 * 1024 * 1024;
}
