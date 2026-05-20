# 5.4 EVM과의 핵심 차이

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

| 항목 | EVM | Solana |
|------|-----|--------|
| 재전송 | gas bump으로 같은 nonce 덮어쓰기 | 불가능. 새 TX 생성 필요 |
| TX 대기 | mempool에서 대기 | 리더가 안 받으면 드롭 |
| 재전송 주기 | gas bump 시에만 | **2초마다 적극적 재전송** |
| 취소 | 같은 nonce로 self-transfer | durable nonce advance |
| 동시 출금 | nonce 순서대로 자동 직렬화 | nonce 계정 풀 크기 = 동시 처리 한도 |
| stuck 판단 | receipt 미확인 + 시간 경과 | signatureStatus 조회 결과 없음 |

## 개발할 내용

1. 원문 내용을 구현 backlog와 검증 과제로 분해한다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. 핵심 개념을 공식 문서와 실제 샘플로 확인한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. 작은 PoC 또는 체크리스트를 만들어 완료 기준을 명확히 한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
