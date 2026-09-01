# WorkQueue acknowledgement validation

This procedure uses a Synadia Cloud Personal/Free account and the NATS CLI to validate WorkQueue consumer acknowledgement behavior.

Run the commands below in PowerShell. The credentials file is used only by the selected local NATS CLI context.

## Connect to Synadia Cloud

Use `tls://`, without a backslash before the colon:

```powershell
nats context save --select "NGS-Default-CLI" --server "tls://connect.ngs.global" --creds "C:\Users\VISMAY\Downloads\NGS-Default-CLI.creds"
nats context select NGS-Default-CLI
nats rtt
```

Expected result: the connection succeeds and `nats rtt` reports a round-trip time.

## Create and inspect a WorkQueue stream

```powershell
nats stream add WORK --subjects "jobs.>" --retention work --storage file --defaults
nats stream info WORK
nats pub jobs.email "job-1"
```

The stream information should show `Retention: WorkQueue` and `Storage: File`.

## Test an AckNone consumer

```powershell
nats consumer add WORK noack --pull --ack none --filter "jobs.>" --defaults
```

Expected result: consumer creation fails because a WorkQueue stream requires an explicit acknowledgement policy. If this command succeeds, stop and investigate the stream configuration.

## Test reading without sending an ACK

Create a valid explicit-ack consumer:

```powershell
nats consumer add WORK worker --pull --ack explicit --filter "jobs.>" --wait 2s --defaults
```

Read the message without acknowledging it and inspect the state:

```powershell
nats consumer next WORK worker --count 1 --no-ack
nats consumer info WORK worker
nats stream info WORK
```

Expected result: `Outstanding Acks` is `1`, and the message remains in the stream.

Wait for the acknowledgement timeout and read again:

```powershell
Start-Sleep -Seconds 3
nats consumer next WORK worker --count 1 --no-ack
nats consumer info WORK worker
nats stream info WORK
```

Expected result: the message is redelivered, normally with a delivery attempt count of `2`.

## Conclusion

The precise finding is:

> An `AckNone` consumer cannot be created on a `WorkQueuePolicy` stream. However, an explicit-ack consumer can receive a message and temporarily leave it unacknowledged; the message remains stored and is redelivered after the acknowledgement timeout.

## Optional cleanup

Run these only in the disposable test account:

```powershell
nats consumer delete WORK worker
nats stream delete WORK
```
