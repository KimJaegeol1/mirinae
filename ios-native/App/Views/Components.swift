import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        Group {
            if app.isManual {
                DashboardView()
            } else {
                StartView()
            }
        }
        .tint(MirinaeTheme.brandSoft)
        .noticeAlert($app.message)
    }
}

/// message 가 nil 이 아니면 "안내" 창을 띄우고, 확인을 누르면 nil 로 되돌린다.
struct NoticeAlert: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.alert(
            "안내",
            isPresented: Binding(
                get: { message != nil },
                set: { if !$0 { message = nil } }
            )
        ) {
            Button("확인", role: .cancel) { message = nil }
        } message: {
            Text(message ?? "")
        }
    }
}

extension View {
    func noticeAlert(_ message: Binding<String?>) -> some View {
        modifier(NoticeAlert(message: message))
    }
}

/// 대시보드 메뉴 버튼 (Android 의 세로 버튼 목록과 같은 역할)
struct MenuButton: View {
    let title: String
    let systemImage: String
    var primary = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .frame(width: 22)
                Text(title)
                    .font(.body.weight(primary ? .semibold : .regular))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 13)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .background(primary ? MirinaeTheme.brandSoft : Color.white, in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(primary ? Color.white : MirinaeTheme.ink)
        }
        .buttonStyle(.plain)
    }
}

/// 흰 카드 배경
struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 20))
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}
