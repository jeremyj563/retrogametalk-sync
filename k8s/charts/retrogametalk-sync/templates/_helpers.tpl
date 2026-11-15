{{/*
Expand the name of the chart.
*/}}
{{- define "retrogametalk-sync.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "retrogametalk-sync.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "retrogametalk-sync.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "retrogametalk-sync.labels" -}}
helm.sh/chart: {{ include "retrogametalk-sync.chart" . }}
{{ include "retrogametalk-sync.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "retrogametalk-sync.selectorLabels" -}}
app.kubernetes.io/name: {{ include "retrogametalk-sync.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Secret name for credentials
*/}}
{{- define "retrogametalk-sync.secretName" -}}
{{- if .Values.credentials.existingSecret }}
{{- .Values.credentials.existingSecret }}
{{- else }}
{{- printf "%s-credentials" (include "retrogametalk-sync.fullname" .) }}
{{- end }}
{{- end }}

{{/*
PVC name for persistent data
*/}}
{{- define "retrogametalk-sync.pvcName" -}}
{{- if .Values.persistence.existingClaim }}
{{- .Values.persistence.existingClaim }}
{{- else }}
{{- printf "%s-data" (include "retrogametalk-sync.fullname" .) }}
{{- end }}
{{- end }}
