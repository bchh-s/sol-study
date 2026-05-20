# 7.4 Transaction 구조

상위 섹션: [7. Solana 기초 개념 상세](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

Transaction (Legacy) {
  signatures: [Signature],        // Ed25519 서명 배열 (64 bytes each)
  message: {
    header: {
      numRequiredSignatures: u8,
      numReadonlySignedAccounts: u8,
      numReadonlyUnsignedAccounts: u8
    },
    accountKeys: [Pubkey],        // 참여 계정 목록 (순서 중요)
    recentBlockhash: Hash,        // 또는 durable nonce 값
    instructions: [
      {
        programIdIndex: u8,       // accountKeys 내 인덱스
        accounts: [u8],           // accountKeys 내 인덱스 배열
        data: [u8]                // 프로그램별 인코딩된 데이터
      }
    ]
  }
}
**Versioned Transaction (v0):**
- Address Lookup Tables (ALT) 지원
- 더 많은 계정을 참조 가능 (1,232 byte 제한 완화)
- `maxSupportedTransactionVersion: 0` 설정 필요

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
