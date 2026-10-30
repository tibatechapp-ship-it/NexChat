import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sila_mobile/main.dart';

void main() {
  testWidgets('يعرض الغرفة والرسائل الابتدائية', (tester) async {
    await tester.pumpWidget(const SilaApp());

    expect(find.text('صلة'), findsOneWidget);
    expect(find.text('ساحة الحي'), findsWidgets);
    expect(
      find.text('صباح الخير. هل ما زال اللقاء عند المكتبة اليوم؟'),
      findsOneWidget,
    );
  });

  testWidgets('الشاشة تعمل على مقاس هاتف ضيق بلا أخطاء تخطيط', (tester) async {
    tester.view.physicalSize = const Size(360 * 3, 640 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const SilaApp());
    expect(tester.takeException(), isNull);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('إرسال رسالة يضيفها ويفرّغ الحقل', (tester) async {
    await tester.pumpWidget(const SilaApp());

    await tester.enterText(find.byType(TextField), 'مرحبا بالجميع');
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(find.text('مرحبا بالجميع'), findsOneWidget);
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, isEmpty);
  });

  testWidgets('الرسالة الفارغة لا تُضاف', (tester) async {
    await tester.pumpWidget(const SilaApp());

    // رسالة واحدة فقط باسم "أنت" قبل الإرسال (الفقاعة الابتدائية).
    expect(find.text('أنت'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '   ');
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    // المسافات فقط لا تُنشئ فقاعة جديدة.
    expect(find.text('أنت'), findsOneWidget);
  });

  testWidgets('تبديل وسيلة النقل يغيّر وسم الرسالة الجديدة', (tester) async {
    await tester.pumpWidget(const SilaApp());

    await tester.tap(find.text('الإنترنت'));
    await tester.pump();

    await tester.enterText(find.byType(TextField), 'عبر الإنترنت');
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(find.text('عبر الإنترنت'), findsOneWidget);
    expect(find.text('Net'), findsWidgets);
  });
}
