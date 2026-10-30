import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sila_mobile/main.dart';

/// نافذة عالية بما يكفي لعرض كل الفقاعات — وإلا فإن `ListView.builder`
/// لا يبني العنصر الجديد (خارج الشاشة) فيفشل البحث عنه بلا سبب حقيقي.
Future<void> pumpApp(WidgetTester tester, {Size logicalSize = const Size(420, 1200)}) async {
  tester.view.physicalSize = logicalSize * 3;
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const SilaApp());
}

Future<void> sendText(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
  // زر الإرسال هو أيقونة الـ suffix داخل الحقل.
  await tester.tap(find.byIcon(Icons.arrow_upward));
  await tester.pump();
}

void main() {
  testWidgets('يعرض الغرفة والرسائل الابتدائية', (tester) async {
    await pumpApp(tester);

    expect(find.text('صلة'), findsOneWidget);
    expect(find.text('ساحة الحي'), findsWidgets);
    expect(
      find.text('صباح الخير. هل ما زال اللقاء عند المكتبة اليوم؟'),
      findsOneWidget,
    );
  });

  testWidgets('الشاشة تعمل على مقاس هاتف ضيق بلا أخطاء تخطيط', (tester) async {
    await pumpApp(tester, logicalSize: const Size(360, 640));

    expect(tester.takeException(), isNull);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('إرسال رسالة يضيفها ويفرّغ الحقل', (tester) async {
    await pumpApp(tester);

    await sendText(tester, 'مرحبا بالجميع');

    expect(find.text('مرحبا بالجميع'), findsOneWidget);
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, isEmpty);
  });

  testWidgets('الرسالة الفارغة لا تُضاف', (tester) async {
    await pumpApp(tester);

    // رسالة واحدة فقط باسم "أنت" قبل الإرسال (الفقاعة الابتدائية).
    expect(find.text('أنت'), findsOneWidget);

    await sendText(tester, '   ');

    // المسافات فقط لا تُنشئ فقاعة جديدة.
    expect(find.text('أنت'), findsOneWidget);
  });

  testWidgets('تبديل وسيلة النقل يغيّر وسم الرسالة الجديدة', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('الإنترنت'));
    await tester.pump();

    await sendText(tester, 'عبر الإنترنت');

    expect(find.text('عبر الإنترنت'), findsOneWidget);
    expect(find.text('Net'), findsWidgets);
  });
}
