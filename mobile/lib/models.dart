class RasanUser {
  final int id;
  final String username;
  final String? publicKey;
  final String? locale;
  RasanUser(
      {required this.id, required this.username, this.publicKey, this.locale});
  factory RasanUser.fromJson(Map<String, dynamic> j) => RasanUser(
        id: j['id'] as int,
        username: j['username'] as String,
        publicKey: j['public_key'] as String?,
        locale: j['locale'] as String?,
      );
}

class RasanConversation {
  final int id;
  final String type;
  final String? name;
  final int members;
  final int? ownerId;
  RasanUser? peer;
  RasanConversation(
      {required this.id,
      required this.type,
      this.name,
      required this.members,
      this.ownerId,
      this.peer});
  factory RasanConversation.fromJson(Map<String, dynamic> j) =>
      RasanConversation(
        id: j['id'] as int,
        type: j['type'] as String,
        name: j['name'] as String?,
        members: j['members'] as int? ?? 0,
        ownerId: j['owner_id'] as int?,
      );
}

class RasanMessage {
  final int id;
  final int conversationId;
  final int senderId;
  final String senderName;
  final String type;
  final String ciphertext;
  final String iv;
  final int time;
  final int keyVersion;
  final String? attachmentId;
  final int? editedAt;
  RasanMessage(
      {required this.id,
      required this.conversationId,
      required this.senderId,
      required this.senderName,
      required this.type,
      required this.ciphertext,
      required this.iv,
      required this.time,
      required this.keyVersion,
      this.attachmentId,
      this.editedAt});
  factory RasanMessage.fromJson(Map<String, dynamic> j) => RasanMessage(
        id: j['id'] as int,
        conversationId: j['conversationId'] as int,
        senderId: j['senderId'] as int,
        senderName: j['senderName'] as String,
        type: j['type'] as String? ?? 'text',
        ciphertext: j['ciphertext'] as String,
        iv: j['iv'] as String,
        time: j['time'] as int,
        keyVersion: j['key_version'] as int? ?? 1,
        attachmentId: j['attachmentId'] as String?,
        editedAt: j['edited_at'] as int?,
      );
}
