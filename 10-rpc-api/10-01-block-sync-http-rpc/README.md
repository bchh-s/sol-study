# 10.1 블록 싱크용 HTTP RPC

상위 섹션: [10. RPC API 레퍼런스](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

| 메서드 | 용도 | 주요 파라미터 |
|--------|------|-------------|
| `getSlot` | 현재 슬롯 번호 | commitment |
| `getBlockHeight` | 현재 블록 높이 | commitment |
| `getBlocks` | 두 슬롯 사이의 확인된 블록 목록 | startSlot, endSlot, commitment |
| `getBlock` | 슬롯 번호로 블록 전체 조회 | slot, encoding, transactionDetails, commitment |
| `getBlockTime` | 블록 생성 시간 | slot |
| `getTransaction` | 서명으로 TX 조회 | signature, encoding, commitment |
| `getSignaturesForAddress` | 주소의 TX 서명 목록 | address, limit, before, until |

## 개발할 내용

1. RPC wrapper/contract test를 작성하고 응답 shape, commitment, retry 정책을 검증한다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. 공식 RPC 문서에서 파라미터, commitment 지원 여부, limit/rate-limit을 확인한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. devnet 호출 샘플 JSON을 저장하고 parser golden test를 만든다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
