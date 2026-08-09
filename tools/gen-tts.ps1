# Generates TTS speech WAVs for the messy-meeting stress recording (DIR-2).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-tts.ps1
param(
  [string]$OutDir = 'vendor/whisper/samples'
)
Add-Type -AssemblyName System.Speech

function Speak-To([string]$path, [string]$text, [int]$rate = 0) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.Rate = $rate
  $s.SetOutputToWaveFile($path)
  $s.Speak($text)
  $s.Dispose()
  Write-Output ("WROTE " + $path + " (" + (Get-Item $path).Length + " bytes)")
}

# Speaker 1 - male, slightly slow (project manager walking the site)
Speak-To "$OutDir\tts-pm.wav" @"
Alright, so let's go over the job. Foundation pour was supposed to start Tuesday but the concrete supplier says the mix design review slipped. I'll chase the revised shop drawings by Friday, before the pour window closes. We agreed to move the rebar delivery up a week to cover the delay. The crane is on site but the lift plan review is still pending with the structural engineer, that's blocking the steel erection. Foreman, what's the crew status?
"@

# Speaker 2 - female, faster (foreman reply)
Speak-To "$OutDir\tts-fm.wav" @"
We got ten guys on the scaffold today, drywall rough-in is about sixty percent done in the east wing. The water table is high and the pump has been running non stop, so excavation is behind by three days. I'll need the revised shoring plan by Monday to keep the trench open, otherwise the inspector shuts us down. Also somebody needs to order the sealant for the curtain wall, the supplier quote expires end of month.
"@

# Overlap voice - background / second conversation (babble that whisper will mangle)
Speak-To "$OutDir\tts-babble.wav" @"
Okay the payroll is due, did you get the timesheets, yeah I emailed them to accounting, make sure the crane invoice is approved before Friday, the client wants a walkthrough next week, we'll need the punch list done first, I'll handle the permits, the inspector is coming at two.
"@

Write-Output "DONE"
