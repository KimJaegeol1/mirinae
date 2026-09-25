import Foundation

/// 금액·시각·회차 표기. 앱과 위젯이 함께 쓴다.
enum MirinaeFormat {
    private static let wonFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter
    }()

    /// 1234567 → "1,234,567" (부호 없이 절댓값. Scriptable won() 과 동일)
    static func won(_ value: Int) -> String {
        wonFormatter.string(from: NSNumber(value: abs(value))) ?? String(abs(value))
    }

    /// "+50,000원" / "-50,000원"
    static func signedWon(_ value: Int) -> String {
        (value >= 0 ? "+" : "-") + won(value) + "원"
    }

    /// epoch ms → "9/20 15:43" (한국시간)
    static func time(_ millis: Int) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = SpendableCalculator.korea
        formatter.dateFormat = "M/d HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
    }

    /// "2026-09" → "2026년 9월", 그 외("2026-09-15" 등)는 그대로
    static func periodLabel(_ value: String) -> String {
        let parts = value.split(separator: "-")
        if parts.count == 2, let year = Int(parts[0]), let month = Int(parts[1]) {
            return "\(year)년 \(month)월"
        }
        return value.isEmpty ? "이번 회차" : value
    }

    /// 숫자만 남겨 Int 로. 비어 있으면 nil
    static func parseAmount(_ text: String) -> Int? {
        let digits = text.filter { $0.isASCII && $0.isNumber }
        guard !digits.isEmpty else { return nil }
        return Int(digits)
    }

    static func iso(_ millis: Int) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
    }

    // DatePicker 는 기기 시간대로 날짜를 고르므로, 그 값을 "yyyy-MM-dd" 로 바꿀 때도 기기 달력을 쓴다.

    private static var deviceGregorian: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    static func localDayString(_ date: Date) -> String {
        let parts = deviceGregorian.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 2000, parts.month ?? 1, parts.day ?? 1)
    }

    static func localDate(from value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return deviceGregorian.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
