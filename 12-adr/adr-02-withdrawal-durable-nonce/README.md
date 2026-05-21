# ADR-2: 출금 Durable Nonce

상위 섹션: [12. Architecture Decision Records](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**결정:** 출금 파이프라인에 durable nonce 사용
**근거:**
- Recent blockhash 60-90초 만료는 KMS 서명 + 정책 승인 파이프라인에 부적합
- Durable nonce는 만료 없음, 결정적 취소 가능
- 서명 후 임의 시간 대기 가능
**Trade-off:** Nonce 계정 풀 관리 운영 복잡성 추가. 각 계정 ~0.0015 SOL 비용.

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
