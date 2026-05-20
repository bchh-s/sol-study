# 7.2 계정 모델

상위 섹션: [7. Solana 기초 개념 상세](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

Solana는 **모든 것이 계정**이다.
Account {
  lamports: u64,          // SOL 잔액
  data: Vec<u8>,          // 임의 데이터 (프로그램이 해석)
  owner: Pubkey,          // 이 계정을 소유한 프로그램
  executable: bool,       // 프로그램 코드인가?
  rent_epoch: u64         // 렌트 관련
}
**Rent (임대료):**
- 모든 계정은 rent-exempt 최소 잔액을 유지해야 함
- 공식: `(128 + data_size) * 6,960 lamports`
- 미달 시 garbage collection (계정 삭제)
- **Rent는 보증금** - 계정 close 시 반환됨
**주요 계정 비용:**
| 계정 유형 | 데이터 크기 | Rent-exempt 비용 |
|----------|-----------|----------------|
| 기본 SOL 계정 | 0 bytes | ~0.00089 SOL |
| SPL Token 계정 | 165 bytes | ~0.00204 SOL |
| Nonce 계정 | 80 bytes | ~0.00145 SOL |

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
