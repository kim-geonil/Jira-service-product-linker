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
- Node.js (프로젝트는 `manifest.yml`의 `nodejs24.x` 런타임과 맞는 버전 권장)

## 설정 방법 (처음 셋업)

아래는 **샌드박스·검증용 Jira 사이트**에 처음 올릴 때의 기준 순서입니다. (운영 사이트는 이 문서 아래 **「샌드박스와 운영(프로덕션) 환경」** 절을 참고하세요.)

### 1. Forge CLI 로그인

```bash
forge login
```

조직 정책에 따라 API 토큰·브라우저 인증이 필요할 수 있습니다. [Forge 설치 가이드](https://developer.atlassian.com/platform/forge/set-up-forge/)를 따릅니다.

### 2. 저장소 받기·의존성·프론트 빌드

```bash
git clone <이-저장소-URL>
cd service-product-linker   # 실제 클론한 폴더명에 맞게 수정
npm install
npm run build
```

`src/frontend/build/`는 Git에 포함되지 않습니다. **clone 직후·배포 전·터널 전**에 `npm run build`로 번들을 만듭니다.

### 3. 앱 배포 (Forge 환경)

프로젝트 **루트**(`manifest.yml`이 있는 디렉터리)에서 실행합니다. 기본은 `development` 환경입니다.

```bash
forge deploy
# 또는 명시적으로
forge deploy -e development
```

배포 전 `forge lint`로 manifest 등을 검사할 수 있습니다. 기본 Forge 환경은 `forge settings list`로 확인합니다.

### 4. Jira 사이트에 앱 설치

**검증(샌드박스)**용 Jira Cloud 사이트 URL을 정합니다. (예: `회사명-sandbox.atlassian.net` 형태)

대화형으로 설치:

```bash
forge install
```

프롬프트에서 사이트·제품(Jira)·환경(`development` 등)을 선택합니다.

비대화형 예시(스크립트·CI용):

```bash
forge install --non-interactive --site <사이트-URL> --product Jira --environment development
```

`<사이트-URL>`은 보통 `https://<사이트>.atlassian.net` 형식입니다. Forge CLI 버전에 따라 옵션 이름이 조금 다를 수 있으므로 `forge install --help`를 확인하세요.

### 5. 어디에 설치됐는지 확인

저장소에는 **연결된 Jira URL이 저장되지 않습니다.** Forge가 설치 정보를 관리합니다.

```bash
forge install list
```

표의 **Site**가 Jira 주소, **Environment**가 배포 환경입니다. 여기서 현재 샌드박스(또는 운영) 연결을 확인합니다.

### 6. 로컬에서 UI·리졸버 개발

```bash
forge tunnel
```

터널이 떠 있는 동안 코드 변경이 반영되는 경우가 많습니다. **`manifest.yml`(스코프·모듈)을 바꾼 뒤에는 `forge deploy` 후 터널을 다시 시작**해야 합니다.

### 7. 스코프·권한을 바꾼 뒤

`manifest.yml`의 `permissions.scopes` 등을 수정했다면:

1. `forge deploy` (필요 시 `-e <환경>`)
2. 같은 사이트에 **`forge install --non-interactive --upgrade`** 등으로 업그레이드

자세한 내용은 [Forge 배포](https://developer.atlassian.com/platform/forge/deploying/) 문서를 참고하세요.

## 샌드박스와 운영(프로덕션) 환경

지금은 **Jira 샌드박스(또는 검증용 사이트)**에 설치해 동작·권한·링크 타입을 확인하는 단계로 두는 것을 권장합니다. 샌드박스와 **실제 운영 사이트**는 데이터·프로젝트·커스텀 필드·이슈 링크 타입 이름이 다를 수 있으므로, 운영 반영 전에 아래를 점검하세요.

- **운영 Jira URL**을 기준으로 `forge install`(또는 스코프 변경 시 `forge install --upgrade`)을 다시 실행해 **운영 사이트에 앱을 설치**합니다. 샌드박스에만 설치된 상태로는 운영 이슈에서 앱이 보이지 않습니다.
- Forge는 **배포 환경**이 나뉩니다(`development` / `staging` / `production` 등). 검증이 끝나면 운영 정책에 맞게 **`forge deploy -e production`**(또는 조직에서 쓰는 운영 환경 이름)으로 올리고, **운영 사이트에는 그 환경에 맞게 설치·업그레이드**합니다. 자세한 것은 [Forge 환경(environments)](https://developer.atlassian.com/platform/forge/environments-and-versions/) 문서를 참고하세요.
- 리졸버·UI에 박혀 있는 **이슈 타입·필드 ID·링크 타입 이름**(예: Deal 타입, `고객사 링크`, `제품 링크`)이 **운영 인스턴스와 동일한지** 반드시 확인합니다. 다르면 JQL·링크 생성이 실패할 수 있습니다.
- 운영 반영 후에는 **실제 이슈에 쓰기 권한**으로 링크가 생성되므로, 필요하면 변경 관리·사용자 안내(이슈 액션 위치, 사용 절차)를 진행합니다.

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
