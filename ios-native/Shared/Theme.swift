import SwiftUI

/// Scriptable 위젯과 같은 색. 위젯은 흰 배경·진한 글자를 고정으로 쓴다.
enum MirinaeTheme {
    static let safe = Color(red: 0 / 255, green: 177 / 255, blue: 118 / 255)        // #00B176
    static let caution = Color(red: 242 / 255, green: 130 / 255, blue: 16 / 255)    // #F28210
    static let danger = Color(red: 254 / 255, green: 88 / 255, blue: 54 / 255)      // #FE5836
    static let ink = Color(red: 45 / 255, green: 45 / 255, blue: 45 / 255)          // #2D2D2D
    static let muted = Color(red: 118 / 255, green: 118 / 255, blue: 118 / 255)     // #767676
    static let faint = Color(red: 138 / 255, green: 138 / 255, blue: 138 / 255)     // #8A8A8A
    static let track = Color(red: 231 / 255, green: 231 / 255, blue: 231 / 255)     // #E7E7E7
    static let overdueText = Color(red: 217 / 255, green: 67 / 255, blue: 43 / 255) // #D9432B
    static let brand = Color(red: 74 / 255, green: 49 / 255, blue: 99 / 255)        // #4A3163 (Android 상태바 보라)
    static let brandSoft = Color(red: 107 / 255, green: 76 / 255, blue: 138 / 255)  // #6B4C8A
    static let paper = Color(red: 247 / 255, green: 245 / 255, blue: 250 / 255)     // #F7F5FA (Android 배경)

    static func gauge(for level: RiskLevel) -> Color {
        switch level {
        case .danger, .critical: return danger
        case .caution: return caution
        case .safe: return safe
        }
    }
}

/// 10칸 게이지. 앱 카드와 위젯이 같이 쓴다.
struct GaugeBar: View {
    let filled: Int
    let color: Color
    var height: CGFloat = 5

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<10, id: \.self) { index in
                RoundedRectangle(cornerRadius: height / 2)
                    .fill(index < filled ? color : MirinaeTheme.track)
                    .frame(height: height)
            }
        }
    }
}

/// "미납 1건" / "고정비" 배지
struct FixedCostBadge: View {
    let overdueCount: Int

    var body: some View {
        Text(overdueCount > 0 ? "미납 \(overdueCount)건" : "고정비")
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(overdueCount > 0 ? MirinaeTheme.danger : MirinaeTheme.caution)
            .cornerRadius(6)
    }
}
