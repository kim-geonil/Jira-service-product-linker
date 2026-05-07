# Jira 서비스 제품 연결 (Forge)

Jira 이슈에서 **고객사 → Deal → 장비(제품 이슈)**를 고르고, 현재 이슈에 **제품 링크**와 **연결된 Deal(고객사 링크)**을 한 번에 만드는 [Atlassian Forge](https://developer.atlassian.com/platform/forge/) 앱입니다.

## 기능 요약

- 이슈에 저장된 **고객사** 정보를 바탕으로 같은 프로젝트의 **Deal(마이그레이션 이슈 타입)** 목록을 불러옵니다.
- Deal을 선택하면 그 Deal에 연결된 **장비(제품) 이슈** 목록을 보여 줍니다.
- 여러 Deal에서 장비를 골라 **누적 선택**할 수 있으며, 링크 생성 시 **선택된 Deal마다** `연결된 Deal` 관계가 생성됩니다.
- 이미 링크된 제품·Deal은 건너뛰고, 결과를 메시지로 요약합니다.

## 모듈

| 항목 | 내용 |
|------|------|
| 진입점 | Jira 이슈 액션 — **「서비스 제품 연결」** (`manifest.yml`의 `jira:issueAction`) |
| UI | Custom UI — `src/frontend` (React + webpack 번들) |
| 백엔드 | Resolver — `src/resolvers/index.js` |

## 필요 환경

- [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/) 및 Atlassian 계정
- Node.js (프로젝트는 `nodejs24.x` 런타임 사용)

## 로컬 설정

```bash
npm install
npm run build
```

`src/frontend/build/`는 `.gitignore`에 포함되어 있어 **저장소를 clone한 뒤에는 반드시 `npm run build`를 한 번 실행**해야 합니다. 배포·터널 전에도 번들이 없으면 동일하게 빌드하세요.

## 배포 및 설치

프로젝트 루트에서:

```bash
forge deploy
forge install
```

스코프나 권한을 `manifest.yml`에서 바꾼 뒤에는 **재배포 후 `forge install --upgrade`**가 필요할 수 있습니다. 자세한 절차는 [Forge 배포 문서](https://developer.atlassian.com/platform/forge/deploying/)를 참고하세요.

## 개발 (터널)

```bash
forge tunnel
```

코드만 수정한 경우 터널이 핫 리로드하는 경우가 많고, **`manifest.yml`을 바꾼 경우에는 재배포 후 터널을 다시 시작**해야 합니다.

## 주요 디렉터리

| 경로 | 설명 |
|------|------|
| `manifest.yml` | 앱 ID, 모듈, 권한 스코프 |
| `src/frontend/index.jsx` | 이슈 액션 UI (고객사·Deal·장비 선택, 링크 생성) |
| `src/resolvers/index.js` | Jira REST 호출 및 `createLinks` 등 resolver |
| `webpack.config.js` | 번들 출력 경로: `src/frontend/build/` |

## 권한 (스코프)

현재 manifest 기준:

- `read:jira-work`
- `write:jira-work`

추가 API를 쓰게 되면 스코프를 늘리고 재배포·재설치해야 합니다.

## 문의 및 참고

- [Forge 개발자 허브](https://developer.atlassian.com/platform/forge/)
- [Forge 도움말](https://developer.atlassian.com/platform/forge/get-help/)
