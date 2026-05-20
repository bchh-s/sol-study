# 5.5 Nonce 계정 풀 관리

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

Nonce Account Pool (per hot wallet)
┌─────────────────────────────────────────┐
│ nonce_account_1: FREE    (storedNonce: abc123...)  │
│ nonce_account_2: IN_USE  (storedNonce: def456...)  │ ← 출금 TX #42에 사용 중
│ nonce_account_3: FREE    (storedNonce: ghi789...)  │
│ nonce_account_4: IN_USE  (storedNonce: jkl012...)  │ ← 출금 TX #43에 사용 중
│ ...                                                 │
│ nonce_account_N: FREE    (storedNonce: xyz999...)  │
└─────────────────────────────────────────┘
관리 규칙:
- 사전 할당: 핫월렛당 100개 (peak 동시 출금 수 기준)
- 비용: 100 * 0.0015 SOL = 0.15 SOL (반환 가능)
- 부족 시: 동적 생성 + 알림
- 모니터링: pool utilization rate 추적
---

## 개발할 내용

1. durable nonce 기반 TX builder/sender/monitor 상태 전이를 구현 계획으로 쪼갠다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. recent blockhash 만료, durable nonce, retry/drop 모델을 학습한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. devnet에서 nonce advance + transfer + signature status 확인을 실행한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
