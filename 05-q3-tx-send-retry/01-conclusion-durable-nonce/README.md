# 결론: Durable Nonce를 사용해야 한다. Mempool이 없으므로 적극적 재전송 필수.

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)

## Executive Summary

Dagaon Core의 Solana 출금 파이프라인에서 **Durable Nonce 사용은 선택이 아니라 필수**이다. 두 가지 이유:

1. **시간 압박**: `recentBlockhash`는 60-90초 내에 만료된다. KMS 서명 파이프라인(라운드트립 1-2초 + 정책 승인 대기 + 큐 대기)을 거치면 서명 완료 시점에 이미 blockhash가 만료되어 있을 수 있다.

2. **Mempool 부재**: Solana에는 mempool이 없어 트랜잭션이 조용히 드롭될 수 있다. 드롭된 TX를 재전송하려면 같은 서명을 반복해서 보내야 하는데, `recentBlockhash` 기반 TX는 만료되면 재전송이 불가능하다.

Durable Nonce는 이 두 문제를 동시에 해결한다: **만료 없는 blockhash** + **무기한 재전송 가능** + **결정적 취소**.

## 의사결정 근거표

| 평가 항목 | recentBlockhash 방식 | Durable Nonce 방식 | 판정 |
|-----------|----------------------|---------------------|------|
| TX 유효 기간 | 60-90초 (150 슬롯) | 무제한 (nonce advance 전까지) | Nonce 우위 |
| KMS 파이프라인 호환성 | 서명 완료 전 만료 위험 | 시간 제약 없음 | Nonce 우위 |
| 재전송 가능 여부 | 만료 후 불가, 재서명 필요 | 같은 서명으로 무한 재전송 | Nonce 우위 |
| TX 취소 | 불가능 (만료 대기만 가능) | nonce advance로 즉시 무효화 | Nonce 우위 |
| 중복 실행 방지 | blockhash 만료 경계에서 위험 | nonce가 원자적으로 소비되므로 안전 | Nonce 우위 |
| 구현 복잡도 | 단순 (getLatestBlockhash 호출) | nonce 계정 풀 관리 필요 | Blockhash 우위 |
| 비용 | 추가 비용 없음 | nonce 계정당 ~0.0015 SOL (rent) | Blockhash 우위 |
| 거래소/커스터디 채택 | 소규모 dApp에서 사용 | 거래소, 커스터디 서비스 표준 | Nonce 우위 |

**결론**: 구현 복잡도와 소량의 추가 비용을 감수하더라도, 출금 안정성과 운영 안전성 측면에서 Durable Nonce가 압도적으로 우위이다.

## 적극적 재전송이 필수인 이유

Solana에는 mempool이 없기 때문에, 트랜잭션을 한 번 보내고 기다리는 것으로는 부족하다:

```
EVM: TX 전송 → mempool에 저장 → 언젠가 블록에 포함 (확실)
Solana: TX 전송 → 리더가 처리 또는 드롭 (불확실)
```

Solana 공식 가이드에서도 2초 간격 적극적 재전송을 권장한다:

```
[재전송 루프 의사코드]

sendTransaction(signedTx, { maxRetries: 0 })  // RPC 자체 재전송 비활성화
signatureSubscribe(txSignature)                // WebSocket으로 확인 감시

while (!confirmed && !expired) {
    sleep(2초)
    sendTransaction(signedTx, { maxRetries: 0 })  // 같은 TX 반복 전송
    status = getSignatureStatuses(txSignature)
    if (status.confirmationStatus >= "confirmed") break
}
```

Durable Nonce를 사용하면 이 재전송 루프에 **시간 제한이 없다**. 네트워크가 불안정해도 안정적으로 출금을 완료할 수 있다.

## Dagaon Core 영향 범위

| 컴포넌트 | 변경 내용 | 우선순위 |
|----------|----------|----------|
| tx-ticketer (-> tx-preparer) | nonce 풀에서 계정 할당, storedNonce 조회 | P0 |
| tx-signer | Solana TX message serialize + Ed25519 서명 | P0 |
| tx-sender | `maxRetries=0` + 2초 간격 재전송 루프 | P0 |
| tx-monitor | `signatureSubscribe` + `getSignatureStatuses` 폴링 | P0 |
| nonce-pool-manager | nonce 계정 풀 생성/관리/확장 (신규) | P0 |
| DB 스키마 | nonce_accounts 테이블, TX 상태 전이 확장 | P1 |
| 알림/모니터링 | 풀 소진율, stuck TX, 재전송 횟수 메트릭 | P1 |

## 핵심 메시지 3줄 요약

1. **Durable Nonce는 필수**: KMS 서명 파이프라인의 시간 제약을 제거하고, 출금 TX의 유효 기간을 무제한으로 만든다.
2. **적극적 재전송은 필수**: mempool이 없으므로 2초 간격으로 TX를 반복 전송해야 한다. Durable Nonce가 있어야 이것이 가능하다.
3. **Nonce 계정 풀은 필수**: 동시 출금 처리량을 결정하므로, 핫월렛당 충분한 nonce 계정을 사전 할당해야 한다.
