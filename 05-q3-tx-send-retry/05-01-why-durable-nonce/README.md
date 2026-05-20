# 5.1 왜 Durable Nonce인가?

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**Recent Blockhash 방식의 문제:**
1. getLatestBlockhash() → blockhash + lastValidBlockHeight
2. TX 빌드 → KMS 서명 (수 초 소요)
3. TX 브로드캐스트
4. 60-90초 내에 미확인 시 → 만료, 처음부터 다시
문제: KMS 라운드트립 + 정책 승인 + 큐 대기 = 60초 초과 가능
     만료 직전 제출 시 → 온체인 확인 + 리트라이 중복 위험
**Durable Nonce 방식:**
1. 사전 생성된 nonce 계정에서 nonce 값 조회
2. TX 빌드 (AdvanceNonceAccount 명령어를 첫 번째로 배치)
3. KMS 서명 (시간 제약 없음)
4. TX 브로드캐스트 → 확인될 때까지 무기한 재전송 가능
5. 취소 시: nonce advance만 실행 → 기존 TX 자동 무효화
장점: 만료 없음, 결정적 취소 가능, 서명 후 임의 시간 대기 가능

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
