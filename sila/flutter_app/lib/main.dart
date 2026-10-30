import 'package:flutter/material.dart';

void main() => runApp(const SilaApp());

class SilaApp extends StatelessWidget {
  const SilaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'صلة',
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0C1513),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFC7F46B),
          brightness: Brightness.dark,
        ),
        fontFamily: 'sans',
        useMaterial3: true,
      ),
      home: const ChatPage(),
    );
  }
}

class ChatMessage {
  ChatMessage(this.author, this.text, this.time, this.isMine, this.transport);
  final String author;
  final String text;
  final String time;
  final bool isMine;
  final String transport;
}

class ChatPage extends StatefulWidget {
  const ChatPage({super.key});

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final composer = TextEditingController();
  String transport = 'mesh';
  String room = 'ساحة الحي';
  final messages = <ChatMessage>[
    ChatMessage('ليان', 'صباح الخير. هل ما زال اللقاء عند المكتبة اليوم؟', '09:42', false, 'Mesh'),
    ChatMessage('أنت', 'نعم، سأكون هناك بعد قليل.', '09:44', true, 'Mesh'),
    ChatMessage('سامر', 'أرسلت الموقع في المجموعة. الإشارة المحلية مستقرة.', '09:48', false, 'Net'),
  ];

  @override
  void dispose() {
    composer.dispose();
    super.dispose();
  }

  void send() {
    final text = composer.text.trim();
    if (text.isEmpty) return;
    setState(() {
      messages.add(ChatMessage('أنت', text, 'الآن', true, transport == 'mesh' ? 'Mesh' : 'Net'));
      composer.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: const Color(0xFF13211D),
          titleSpacing: 18,
          title: const Row(children: [
            CircleAvatar(backgroundColor: Color(0xFFC7F46B), child: Text('ص', style: TextStyle(color: Color(0xFF142117), fontWeight: FontWeight.bold))),
            SizedBox(width: 10),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('صلة', style: TextStyle(fontWeight: FontWeight.bold)), Text('تواصل بلا حدود', style: TextStyle(fontSize: 10, color: Color(0xFF8C9B94)))])
          ]),
          actions: const [Padding(padding: EdgeInsets.symmetric(horizontal: 18), child: Row(children: [Icon(Icons.circle, size: 8, color: Color(0xFFC7F46B)), SizedBox(width: 6), Text('متصل', style: TextStyle(fontSize: 11))]))],
        ),
        body: Column(children: [
          _roomHeader(),
          _transportPicker(),
          Expanded(child: ListView.builder(padding: const EdgeInsets.fromLTRB(18, 18, 18, 12), itemCount: messages.length, itemBuilder: (_, index) => _messageTile(messages[index]))),
          _composer(),
        ]),
      ),
    );
  }

  Widget _roomHeader() => Padding(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 14),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('مساحة مشتركة', style: TextStyle(color: Color(0xFF8C9B94), fontSize: 11)), Text(room, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.bold)), const Text('مزامنة عبر الإنترنت والشبكة المحلية', style: TextStyle(color: Color(0xFF8C9B94), fontSize: 11))]),
          IconButton(onPressed: () {}, icon: const Icon(Icons.ios_share, color: Color(0xFFC7F46B))),
        ]),
      );

  Widget _transportPicker() => Container(
        margin: const EdgeInsets.symmetric(horizontal: 18),
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(color: const Color(0xFF111E1A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0x1AFFFFFF))),
        child: Row(children: [
          Expanded(child: _transportButton('mesh', Icons.device_hub, 'Mesh محلي')),
          Expanded(child: _transportButton('internet', Icons.public, 'الإنترنت')),
        ]),
      );

  Widget _transportButton(String value, IconData icon, String label) => FilledButton.icon(
        onPressed: () => setState(() => transport = value),
        icon: Icon(icon, size: 17),
        label: Text(label, style: const TextStyle(fontSize: 11)),
        style: FilledButton.styleFrom(backgroundColor: transport == value ? const Color(0xFFC7F46B) : Colors.transparent, foregroundColor: transport == value ? const Color(0xFF142117) : const Color(0xFF8C9B94), elevation: 0),
      );

  Widget _messageTile(ChatMessage message) => Align(
        alignment: message.isMine ? Alignment.centerLeft : Alignment.centerRight,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 330),
          margin: const EdgeInsets.only(bottom: 18),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: message.isMine ? MainAxisAlignment.end : MainAxisAlignment.start, children: [
            CircleAvatar(backgroundColor: message.isMine ? const Color(0xFFC7F46B) : const Color(0xFFA7D7D3), foregroundColor: const Color(0xFF18241F), child: Text(message.author.characters.first)),
            const SizedBox(width: 9),
            Flexible(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [Text(message.author, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)), const SizedBox(width: 8), Text(message.time, style: const TextStyle(color: Color(0xFF66756C), fontSize: 10)), const SizedBox(width: 6), Text(message.transport, style: TextStyle(color: message.transport == 'Mesh' ? const Color(0xFFC7F46B) : const Color(0xFF72B7DB), fontSize: 9))]), const SizedBox(height: 5), Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: message.isMine ? const Color(0x3A4F6F34) : const Color(0xB8192A24), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0x1AFFFFFF))), child: Text(message.text, style: const TextStyle(fontSize: 13, height: 1.6))) ])),
          ]),
        ),
      );

  Widget _composer() => SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 12), child: TextField(controller: composer, onSubmitted: (_) => send(), decoration: InputDecoration(hintText: 'اكتب رسالة إلى $room...', hintStyle: const TextStyle(color: Color(0xFF6E7E75), fontSize: 12), prefixIcon: const Icon(Icons.add, color: Color(0xFF82958A)), suffixIcon: IconButton(onPressed: send, icon: const Icon(Icons.arrow_upward, color: Color(0xFF142117)), style: IconButton.styleFrom(backgroundColor: const Color(0xFFC7F46B))), filled: true, fillColor: const Color(0xFF14231E), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0x3DC7F46B))), enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0x3DC7F46B)))))));
}
