# 5.2 Durable Nonce 상세

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**Nonce 계정이란?**
- 온체인에 생성되는 특수 System Program 계정
- 내부에 `storedNonce` 값 (32바이트 blockhash 형태) 저장
- `AdvanceNonce` 명령어가 실행되면 값이 갱신됨
- TX의 blockhash 필드에 이 storedNonce를 넣으면 만료되지 않음
**Nonce 계정 생성:**
1. CreateAccount (rent-exempt ~0.0015 SOL)
2. InitializeNonceAccount(nonce_authority: hot_wallet_pubkey)
→ nonce 계정 준비 완료
**TX에서의 사용:**
Transaction:
  Instruction[0]: AdvanceNonceAccount(nonce_account, authority)  ← 반드시 첫 번째
  Instruction[1]: Transfer(from, to, amount)                    ← 실제 작업
  ...
  recentBlockhash: <nonce 계정의 storedNonce 값>               ← 일반 blockhash 대신
**취소 방법:**
// nonce만 advance하고 다른 명령어 없이 실행
Transaction:
  Instruction[0]: AdvanceNonceAccount(nonce_account, authority)
→ storedNonce가 바뀌므로 이전 서명된 TX는 자동 무효화

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
