<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><Setting /></el-icon>
          配置管理
        </h2>
        <el-space>
          <el-button type="primary" :icon="Plus" @click="openAddAccount">
            新增账号
          </el-button>
          <el-button :icon="Download" @click="handleDownloadConfig">
            下载当前配置
          </el-button>
          <el-button type="success" :icon="Refresh" @click="handleReload">
            重载配置
          </el-button>
          <el-button type="primary" :icon="Check" @click="handleSave">
            保存配置
          </el-button>
        </el-space>
      </div>
      <el-card shadow="never" class="config-card">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="表单" name="schema">
            <div v-if="schemaGroups.length" class="schema-form">
              <el-collapse v-model="activeGroups">
                <el-collapse-item
                  v-for="group in schemaGroups"
                  :key="group.key"
                  :title="group.title"
                  :name="group.key"
                >
                  <el-form :model="formModel" label-width="140px">
                    <el-form-item
                      v-for="field in group.fields"
                      :key="field.key"
                      :label="field.label"
                      :required="field.rule.required"
                    >
                  <el-input
                    v-if="field.rule.type === 'string' && !field.rule.enum"
                    v-model="formModel[field.key]"
                    :placeholder="field.placeholder"
                  />
                  <el-input-number
                    v-else-if="field.rule.type === 'number'"
                    v-model="formModel[field.key]"
                    :min="field.rule.min"
                    :max="field.rule.max"
                    controls-position="right"
                    class="schema-input-number"
                  />
                  <el-switch
                    v-else-if="field.rule.type === 'boolean'"
                    v-model="formModel[field.key]"
                  />
                  <el-select
                    v-else-if="field.rule.enum"
                    v-model="formModel[field.key]"
                    class="schema-select"
                  >
                    <el-option
                      v-for="option in field.rule.enum"
                      :key="String(option)"
                      :label="String(option)"
                      :value="option"
                    />
                  </el-select>
                  <el-input
                    v-else-if="field.rule.type === 'object' || field.rule.type === 'array'"
                    v-model="formModel[field.key]"
                    type="textarea"
                    :autosize="{ minRows: 3, maxRows: 10 }"
                    :placeholder="field.placeholder || '请输入 JSON'"
                  />
                  <el-input
                    v-else
                    v-model="formModel[field.key]"
                    :placeholder="field.placeholder"
                  />
                  <el-text v-if="field.rule.description" class="schema-help">
                    {{ field.rule.description }}
                  </el-text>
                    </el-form-item>
                  </el-form>
                </el-collapse-item>
              </el-collapse>
            </div>
            <el-empty v-else description="未获取到配置 Schema" />
          </el-tab-pane>
          <el-tab-pane label="原始配置" name="raw">
            <el-input
              v-model="config"
              type="textarea"
              :autosize="{ minRows: 25, maxRows: 40 }"
              placeholder="配置内容"
              class="config-textarea"
            />
          </el-tab-pane>
          <el-tab-pane label="站点静态" name="static">
            <div class="static-pane">
              <el-alert type="info" show-icon :closable="false" class="static-alert">
                <template #title>可信域名等校验文件</template>
                请先在「表单」→「基础配置」中设置 <strong>public_static_dir</strong>（如 <code>static</code>）并<strong>保存配置</strong>后，再上传文件。保存后公网访问地址示例：
                <code>{{ publicBaseUrl }}你的文件名.txt</code>
                <span v-if="staticHfHint">；{{ staticHfHint }}</span>
              </el-alert>
              <el-alert v-if="staticError" type="warning" show-icon :closable="false" class="static-alert">
                {{ staticError }}
              </el-alert>
              <el-space wrap class="static-toolbar">
                <el-upload
                  :show-file-list="false"
                  accept=".txt,.html,.json,text/plain"
                  :disabled="staticUploading"
                  :http-request="submitStaticUpload"
                >
                  <el-button type="primary" :icon="Upload" :loading="staticUploading">
                    上传文件
                  </el-button>
                </el-upload>
                <el-button :icon="Refresh" :loading="staticLoading" @click="loadStaticFiles">
                  刷新列表
                </el-button>
              </el-space>
              <el-text v-if="staticRootDisplay" type="info" class="static-root-hint">
                目录：{{ staticRootDisplay }}
              </el-text>
              <el-table
                v-loading="staticLoading"
                :data="staticFiles"
                style="width: 100%"
                empty-text="暂无文件"
              >
                <el-table-column prop="name" label="文件名" min-width="220" />
                <el-table-column label="公网路径" min-width="280">
                  <template #default="scope">
                    <code class="static-path">{{ publicBaseUrl }}{{ scope.row.name }}</code>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="120">
                  <template #default="scope">
                    <el-button
                      type="danger"
                      size="small"
                      :icon="Delete"
                      @click="handleDeleteStaticFile(scope.row.name)"
                    >
                      删除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-tab-pane>
          <el-tab-pane label="账号" name="accounts">
            <el-table :data="accounts" style="width: 100%" :empty-text="accountEmptyText">
              <el-table-column prop="platform" label="平台" width="160" />
              <el-table-column prop="account_id" label="账号ID" width="200" />
              <el-table-column label="配置" min-width="300">
                <template #default="scope">
                  <pre class="config-preview">{{ scope.row.preview }}</pre>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="200">
                <template #default="scope">
                  <el-space>
                    <el-button size="small" type="primary" @click="openEditAccount(scope.row)">
                      编辑
                    </el-button>
                    <el-button size="small" type="danger" @click="handleRemoveAccount(scope.row)">
                      删除
                    </el-button>
                  </el-space>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>
  </el-scrollbar>

  <el-dialog v-model="accountDialogVisible" :title="accountDialogTitle" width="760px">
    <el-form :model="accountForm" label-width="120px">
      <el-form-item label="平台" required>
        <el-select v-model="accountForm.platform" placeholder="选择平台" class="schema-select">
          <el-option v-for="name in adapterNames" :key="name" :label="name" :value="name" />
        </el-select>
      </el-form-item>
      <el-form-item label="账号ID" required>
        <el-input v-model="accountForm.account_id" placeholder="例如: my_bot" />
      </el-form-item>
    </el-form>

    <el-divider>协议配置</el-divider>
    <el-collapse v-model="accountActiveProtocolGroups">
      <el-collapse-item v-for="group in accountProtocolGroups" :key="group.key" :name="group.key">
        <template #title>
          <el-space>
            <el-switch v-model="accountProtocolEnabled[group.key]" size="small" />
            <span>{{ group.title }}</span>
          </el-space>
        </template>
        <el-form :model="accountFormModel" label-width="140px" class="schema-section">
          <el-form-item
            v-for="field in group.fields"
            :key="field.key"
            :label="field.label"
            :required="field.rule.required"
          >
            <el-input
              v-if="field.rule.type === 'string' && !field.rule.enum"
              v-model="accountFormModel[field.key]"
              :placeholder="field.placeholder"
              :disabled="!accountProtocolEnabled[group.key]"
            />
            <el-input-number
              v-else-if="field.rule.type === 'number'"
              v-model="accountFormModel[field.key]"
              :min="field.rule.min"
              :max="field.rule.max"
              controls-position="right"
              class="schema-input-number"
              :disabled="!accountProtocolEnabled[group.key]"
            />
            <el-switch
              v-else-if="field.rule.type === 'boolean'"
              v-model="accountFormModel[field.key]"
              :disabled="!accountProtocolEnabled[group.key]"
            />
            <el-select
              v-else-if="field.rule.enum"
              v-model="accountFormModel[field.key]"
              class="schema-select"
              :disabled="!accountProtocolEnabled[group.key]"
            >
              <el-option
                v-for="option in field.rule.enum"
                :key="String(option)"
                :label="String(option)"
                :value="option"
              />
            </el-select>
            <el-input
              v-else-if="field.rule.type === 'object' || field.rule.type === 'array'"
              v-model="accountFormModel[field.key]"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 10 }"
              :placeholder="field.placeholder || '请输入 JSON'"
              :disabled="!accountProtocolEnabled[group.key]"
            />
            <el-input
              v-else
              v-model="accountFormModel[field.key]"
              :placeholder="field.placeholder"
              :disabled="!accountProtocolEnabled[group.key]"
            />
            <el-text v-if="field.rule.description" class="schema-help">
              {{ field.rule.description }}
            </el-text>
          </el-form-item>
        </el-form>
      </el-collapse-item>
    </el-collapse>

    <el-divider>平台配置</el-divider>
    <el-form v-if="accountAdapterFields.length" :model="accountFormModel" label-width="140px" class="schema-section">
      <el-form-item
        v-for="field in accountAdapterFields"
        :key="field.key"
        :label="field.label"
        :required="field.rule.required"
      >
        <el-input
          v-if="field.rule.type === 'string' && !field.rule.enum"
          v-model="accountFormModel[field.key]"
          :placeholder="field.placeholder"
        />
        <el-input-number
          v-else-if="field.rule.type === 'number'"
          v-model="accountFormModel[field.key]"
          :min="field.rule.min"
          :max="field.rule.max"
          controls-position="right"
          class="schema-input-number"
        />
        <el-switch
          v-else-if="field.rule.type === 'boolean'"
          v-model="accountFormModel[field.key]"
        />
        <el-select
          v-else-if="field.rule.enum"
          v-model="accountFormModel[field.key]"
          class="schema-select"
        >
          <el-option
            v-for="option in field.rule.enum"
            :key="String(option)"
            :label="String(option)"
            :value="option"
          />
        </el-select>
        <el-input
          v-else-if="field.rule.type === 'object' || field.rule.type === 'array'"
          v-model="accountFormModel[field.key]"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 10 }"
          :placeholder="field.placeholder || '请输入 JSON'"
        />
        <el-input
          v-else
          v-model="accountFormModel[field.key]"
          :placeholder="field.placeholder"
        />
        <el-text v-if="field.rule.description" class="schema-help">
          {{ field.rule.description }}
        </el-text>
      </el-form-item>
    </el-form>
    <el-empty v-else description="暂无平台 Schema" />

    <template #footer>
      <el-space>
        <el-button @click="accountDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitAccount">保存</el-button>
      </el-space>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed, watch } from 'vue'
import { Setting, Refresh, Check, Plus, Download, Upload, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { buildApiUrl } from '../config'
import { authFetch } from '../composables/useAuth'
import yaml from 'js-yaml'

type ValidationRule = {
  required?: boolean
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  min?: number
  max?: number
  pattern?: RegExp
  enum?: any[]
  default?: any
  label?: string
  description?: string
  placeholder?: string
}

type Schema = Record<string, ValidationRule | Schema>
type SchemaBundle = {
  base?: Schema
  general?: Schema
  protocols?: Record<string, Schema>
  adapters?: Record<string, Schema>
}

type SchemaField = {
  path: string[]
  key: string
  label: string
  rule: ValidationRule
  placeholder: string
}

type SchemaGroup = {
  key: string
  title: string
  fields: SchemaField[]
}

const config = ref<string>('')
const activeTab = ref<'schema' | 'raw' | 'accounts' | 'static'>('schema')
const schema = ref<SchemaBundle | null>(null)
const schemaGroups = ref<SchemaGroup[]>([])
const activeGroups = ref<string[]>([])
const formModel = reactive<Record<string, any>>({})

type AccountRow = {
  key: string
  platform: string
  account_id: string
  config: Record<string, any>
  preview: string
}

const accounts = ref<AccountRow[]>([])
const accountEmptyText = ref('暂无账号')
const accountDialogVisible = ref(false)
const accountDialogTitle = ref('新增账号')
const accountForm = ref({ platform: '', account_id: '' })
const accountOriginalConfig = ref<Record<string, any>>({})
const accountFormModel = reactive<Record<string, any>>({})
const accountProtocolGroups = ref<SchemaGroup[]>([])
const accountAdapterFields = ref<SchemaField[]>([])
const accountActiveProtocolGroups = ref<string[]>([])
const accountProtocolEnabled = reactive<Record<string, boolean>>({})
const isAccountEdit = ref(false)

/** 站点根静态文件（public_static_dir） */
const staticFiles = ref<{ name: string }[]>([])
const staticRootDisplay = ref('')
const staticError = ref('')
const staticLoading = ref(false)
const staticUploading = ref(false)

/** Hugging Face Space 典型域名，用于提示上传后会触发仓库备份 */
const staticHfHint =
  typeof window !== 'undefined' && /\.hf\.space$/i.test(window.location.hostname)
    ? '在 HF 上若已配置 HF_TOKEN / HF_REPO_ID，上传或删除后将自动把整包 data（含 static）推送到 Space 仓库，避免重启丢失'
    : ''

const publicBaseUrl =
  typeof window !== 'undefined' ? `${window.location.origin}/` : '/'

type StaticApiHfBackup = { attempted: boolean; success?: boolean; message?: string }

const notifyStaticHfBackup = (hf: StaticApiHfBackup | undefined, primaryOk: string) => {
  if (!hf?.attempted) {
    ElMessage.success(primaryOk)
    return
  }
  if (hf.success) {
    ElMessage.success(`${primaryOk}，已同步备份至 Hugging Face 仓库（config_backup.yaml + data_backup.tar.gz）`)
  } else {
    ElMessage.warning(`${primaryOk}，但 Hugging Face 备份失败：${hf.message || '未知错误'}，请检查 Secrets 或稍后重试`)
  }
}

const isRule = (rule: ValidationRule | Schema): rule is ValidationRule => {
  return typeof rule === 'object' && ('type' in rule || 'required' in rule || 'enum' in rule || 'default' in rule)
}

const makeKey = (path: string[]) => path.join('::')

const getValueByPath = (data: Record<string, any>, path: string[]) => {
  return path.reduce((acc, key) => (acc ? acc[key] : undefined), data)
}

const setValueByPath = (data: Record<string, any>, path: string[], value: any) => {
  const keys = path
  let current = data
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value
      return
    }
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key]
  })
}

const buildSchemaFields = (schemaData: Schema, basePath: string[] = []): SchemaField[] => {
  const fields: SchemaField[] = []
  Object.entries(schemaData).forEach(([key, rule]) => {
    const currentPath = [...basePath, key]
    if (isRule(rule)) {
      fields.push({
        path: currentPath,
        key: makeKey(currentPath),
        label: rule.label || currentPath.join('.'),
        rule,
        placeholder: rule.placeholder || (rule.default !== undefined ? `默认：${String(rule.default)}` : '')
      })
    } else {
      fields.push(...buildSchemaFields(rule as Schema, currentPath))
    }
  })
  return fields
}

const syncFormModel = (configObject: Record<string, any>) => {
  schemaGroups.value.forEach((group) => {
    group.fields.forEach((field) => {
      const currentValue = getValueByPath(configObject, field.path)
    if (field.rule.type === 'object' || field.rule.type === 'array') {
      const baseValue = currentValue ?? field.rule.default ?? (field.rule.type === 'array' ? [] : {})
      formModel[field.key] = JSON.stringify(baseValue, null, 2)
      return
    }
      formModel[field.key] = currentValue ?? field.rule.default ?? (field.rule.type === 'boolean' ? false : '')
    })
  })
}

const syncAccountFormModel = (configObject: Record<string, any>) => {
  accountProtocolGroups.value.forEach((group) => {
    const enabled = Boolean(configObject[group.key])
    accountProtocolEnabled[group.key] = enabled
    group.fields.forEach((field) => {
      const currentValue = getValueByPath(configObject, field.path)
      if (field.rule.type === 'object' || field.rule.type === 'array') {
        const baseValue = currentValue ?? field.rule.default ?? (field.rule.type === 'array' ? [] : {})
        accountFormModel[field.key] = JSON.stringify(baseValue, null, 2)
        return
      }
      accountFormModel[field.key] = currentValue ?? field.rule.default ?? (field.rule.type === 'boolean' ? false : '')
    })
  })

  accountAdapterFields.value.forEach((field) => {
    const currentValue = getValueByPath(configObject, field.path)
    if (field.rule.type === 'object' || field.rule.type === 'array') {
      const baseValue = currentValue ?? field.rule.default ?? (field.rule.type === 'array' ? [] : {})
      accountFormModel[field.key] = JSON.stringify(baseValue, null, 2)
      return
    }
    accountFormModel[field.key] = currentValue ?? field.rule.default ?? (field.rule.type === 'boolean' ? false : '')
  })
}

const normalizeSchema = (data: Schema | SchemaBundle): SchemaBundle => {
  if ('base' in data || 'general' in data || 'protocols' in data || 'adapters' in data) {
    return data as SchemaBundle
  }
  return { base: data as Schema }
}

const buildGroups = (configObject: Record<string, any>) => {
  if (!schema.value) {
    schemaGroups.value = []
    return
  }

  const groups: SchemaGroup[] = []
  const bundle = schema.value

  if (bundle.base) {
    groups.push({
      key: 'base',
      title: '基础配置',
      fields: buildSchemaFields(bundle.base)
    })
  }

  if (bundle.general) {
    groups.push({
      key: 'general',
      title: '全局协议配置',
      fields: buildSchemaFields(bundle.general, ['general'])
    })
  }

  const baseKeys = new Set(['port', 'path', 'database', 'timeout', 'username', 'password', 'log_level', 'general'])
  const accountKeys = Object.keys(configObject).filter((key) => key.includes('.') && !baseKeys.has(key))

  if (accountKeys.length && (bundle.protocols || bundle.adapters)) {
    accountKeys.forEach((accountKey) => {
      const fields: SchemaField[] = []
      if (bundle.protocols) {
        Object.entries(bundle.protocols).forEach(([protocolKey, protocolSchema]) => {
          fields.push(...buildSchemaFields(protocolSchema, [accountKey, protocolKey]))
        })
      }
      if (bundle.adapters) {
        const platform = accountKey.split('.')[0]
        const adapterSchema = bundle.adapters[platform]
        if (adapterSchema) {
          const adapterFields = buildSchemaFields(adapterSchema, [accountKey]).filter(
            (field) => field.path.join('.') !== `${accountKey}.account_id`
          )
          fields.push(...adapterFields)
        }
      }
      if (fields.length) {
        groups.push({
          key: `account:${accountKey}`,
          title: `账号配置：${accountKey}`,
          fields
        })
      }
    })
  }

  schemaGroups.value = groups
  activeGroups.value = groups.map(group => group.key)
}

const adapterNames = computed(() => Object.keys(schema.value?.adapters || {}))

const buildAccountProtocolGroups = () => {
  if (!schema.value?.protocols) {
    accountProtocolGroups.value = []
    return
  }
  const groups: SchemaGroup[] = []
  Object.entries(schema.value.protocols).forEach(([protocolKey, protocolSchema]) => {
    groups.push({
      key: protocolKey,
      title: protocolKey,
      fields: buildSchemaFields(protocolSchema, [protocolKey])
    })
    if (accountProtocolEnabled[protocolKey] === undefined) {
      accountProtocolEnabled[protocolKey] = false
    }
  })
  accountProtocolGroups.value = groups
  accountActiveProtocolGroups.value = groups.map(group => group.key)
}

const buildAccountAdapterFields = (platform: string) => {
  const adapterSchema = schema.value?.adapters?.[platform]
  if (!adapterSchema) {
    accountAdapterFields.value = []
    return
  }
  accountAdapterFields.value = buildSchemaFields(adapterSchema, []).filter(
    (field) => field.path.join('.') !== 'account_id'
  )
}

const loadAccounts = () => {
  const configObject = (yaml.load(config.value) || {}) as Record<string, any>
  const baseKeys = new Set(['port', 'path', 'database', 'timeout', 'username', 'password', 'log_level', 'general'])
  const rows: AccountRow[] = []

  Object.entries(configObject).forEach(([key, value]) => {
    if (!key.includes('.') || baseKeys.has(key)) return
    const [platform, ...rest] = key.split('.')
    const account_id = rest.join('.')
    rows.push({
      key,
      platform,
      account_id,
      config: value as Record<string, any>,
      preview: JSON.stringify(value, null, 2)
    })
  })

  accounts.value = rows
  accountEmptyText.value = rows.length ? '' : '暂无账号'
}

const loadConfig = async () => {
  try {
    const response = await authFetch(buildApiUrl('/api/config'))
    if (response.ok) {
      config.value = await response.text()
      const configObject = (yaml.load(config.value) || {}) as Record<string, any>
      buildGroups(configObject)
      loadAccounts()
      if (schemaGroups.value.length) {
        syncFormModel(configObject)
      }
    }
  } catch (error) {
    console.error('加载配置失败:', error)
    ElMessage.error('加载配置失败')
  }
}

const loadSchema = async () => {
  try {
    const response = await authFetch(buildApiUrl('/api/config/schema'))
    if (response.ok) {
      const rawSchema = await response.json()
      schema.value = normalizeSchema(rawSchema)
      buildAccountProtocolGroups()
    }
  } catch (error) {
    console.error('加载配置 Schema 失败:', error)
  }
}

const handleReload = () => {
  ElMessage.info('正在重载配置...')
  loadSchema()
  loadConfig()
}

const handleDownloadConfig = async () => {
  try {
    const response = await authFetch(buildApiUrl('/api/config'))
    if (!response.ok) throw new Error('获取配置失败')
    const text = await response.text()
    const blob = new Blob([text], { type: 'application/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `config.yaml`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已下载 config.yaml')
  } catch (e) {
    ElMessage.error((e as Error).message || '下载失败')
  }
}

const handleSave = async () => {
  try {
    if (activeTab.value === 'schema') {
      const configObject = (yaml.load(config.value) || {}) as Record<string, any>
      for (const group of schemaGroups.value) {
        for (const field of group.fields) {
          let value = formModel[field.key]
          if (field.rule.type === 'object' || field.rule.type === 'array') {
            try {
              value = value ? JSON.parse(value) : (field.rule.type === 'array' ? [] : {})
            } catch (error) {
              ElMessage.error(`字段 ${field.label} 不是有效 JSON`)
              return
            }
          }
          setValueByPath(configObject, field.path, value)
        }
      }
      config.value = yaml.dump(configObject, { lineWidth: 120 })
    }
    const response = await authFetch(buildApiUrl('/api/config'), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: config.value
    })
    if (response.ok) {
      const result = await response.json()
      ElMessage.success(result.message || '配置已保存')
    } else {
      const result = await response.json()
      ElMessage.error(result.message || '保存失败')
    }
  } catch (error) {
    console.error('保存配置失败:', error)
    ElMessage.error('保存配置失败')
  }
}

const loadStaticFiles = async () => {
  staticLoading.value = true
  staticError.value = ''
  try {
    const response = await authFetch(buildApiUrl('/api/public-static/files'))
    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean
      message?: string
      files?: string[]
      root?: string
    }
    if (!response.ok) {
      staticFiles.value = []
      staticRootDisplay.value = ''
      staticError.value = data.message || '无法加载列表（请检查是否已配置 public_static_dir 并保存）'
      return
    }
    staticFiles.value = (data.files || []).map((name) => ({ name }))
    staticRootDisplay.value = data.root || ''
  } catch {
    staticFiles.value = []
    staticRootDisplay.value = ''
    staticError.value = '加载静态文件列表失败'
  } finally {
    staticLoading.value = false
  }
}

/** 使用 authFetch 以便 401 时刷新 Token，与下载配置等行为一致 */
const submitStaticUpload = async (options: {
  file: File
  onSuccess?: (body?: unknown) => void
  onError?: (err: Error) => void
}) => {
  staticUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', options.file, options.file.name)
    const res = await authFetch(buildApiUrl('/api/public-static/upload'), {
      method: 'POST',
      body: fd,
    })
    const data = (await res.json().catch(() => ({}))) as {
      message?: string
      hf_backup?: StaticApiHfBackup
    }
    if (!res.ok) {
      const err = new Error(data.message || '上传失败')
      options.onError?.(err)
      ElMessage.error(data.message || '上传失败')
      return
    }
    options.onSuccess?.(data)
    notifyStaticHfBackup(data.hf_backup, data.message || '上传成功')
    await loadStaticFiles()
  } catch (e) {
    const err = e instanceof Error ? e : new Error('上传失败')
    options.onError?.(err)
    ElMessage.error('上传失败，请检查网络、登录状态或文件是否过大（≤2MB）')
  } finally {
    staticUploading.value = false
  }
}

const handleDeleteStaticFile = async (name: string) => {
  try {
    await ElMessageBox.confirm(`确定删除「${name}」吗？`, '删除静态文件', { type: 'warning' })
  } catch {
    return
  }
  const response = await authFetch(
    buildApiUrl(`/api/public-static/${encodeURIComponent(name)}`),
    { method: 'DELETE' },
  )
  const result = (await response.json().catch(() => ({}))) as {
    message?: string
    hf_backup?: StaticApiHfBackup
  }
  if (response.ok) {
    notifyStaticHfBackup(result.hf_backup, result.message || '已删除')
    await loadStaticFiles()
  } else {
    ElMessage.error(result.message || '删除失败')
  }
}

onMounted(() => {
  loadSchema().finally(loadConfig)
})

watch(activeTab, (name) => {
  if (name === 'static') void loadStaticFiles()
})

const openAddAccount = () => {
  accountDialogTitle.value = '新增账号'
  isAccountEdit.value = false
  accountOriginalConfig.value = {}
  accountForm.value = { platform: '', account_id: '' }
  buildAccountAdapterFields('')
  syncAccountFormModel({})
  accountDialogVisible.value = true
}

const openEditAccount = (row: AccountRow) => {
  accountDialogTitle.value = '编辑账号'
  isAccountEdit.value = true
  accountOriginalConfig.value = JSON.parse(JSON.stringify(row.config || {}))
  accountForm.value = { platform: row.platform, account_id: row.account_id }
  buildAccountAdapterFields(row.platform)
  syncAccountFormModel(row.config || {})
  accountDialogVisible.value = true
}

const handleSubmitAccount = async () => {
  if (!accountForm.value.platform || !accountForm.value.account_id) {
    ElMessage.warning('请填写平台与账号ID')
    return
  }

  const configObject = JSON.parse(JSON.stringify(accountOriginalConfig.value || {}))

  for (const group of accountProtocolGroups.value) {
    if (!accountProtocolEnabled[group.key]) {
      delete configObject[group.key]
      continue
    }
    for (const field of group.fields) {
      let value = accountFormModel[field.key]
      if (field.rule.type === 'object' || field.rule.type === 'array') {
        try {
          value = value ? JSON.parse(value) : (field.rule.type === 'array' ? [] : {})
        } catch {
          ElMessage.error(`字段 ${field.label} 不是有效 JSON`)
          return
        }
      }
      setValueByPath(configObject, field.path, value)
    }
  }

  for (const field of accountAdapterFields.value) {
    let value = accountFormModel[field.key]
    if (field.rule.type === 'object' || field.rule.type === 'array') {
      try {
        value = value ? JSON.parse(value) : (field.rule.type === 'array' ? [] : {})
      } catch {
        ElMessage.error(`字段 ${field.label} 不是有效 JSON`)
        return
      }
    }
    setValueByPath(configObject, field.path, value)
  }

  const payload = {
    ...configObject,
    platform: accountForm.value.platform,
    account_id: accountForm.value.account_id
  }

  const url = isAccountEdit.value ? '/api/edit' : '/api/add'
  const response = await authFetch(buildApiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (response.ok) {
    ElMessage.success('保存成功')
    accountDialogVisible.value = false
    await loadConfig()
  } else {
    const result = await response.json().catch(() => ({}))
    ElMessage.error(result.message || '保存失败')
  }
}

const handleRemoveAccount = async (row: AccountRow) => {
  try {
    await ElMessageBox.confirm(`确认删除账号 ${row.platform}.${row.account_id} 吗？`, '提示', {
      type: 'warning'
    })
  } catch {
    return
  }

  const url = buildApiUrl(`/api/remove?platform=${encodeURIComponent(row.platform)}&uin=${encodeURIComponent(row.account_id)}`)
  const response = await authFetch(url)
  if (response.ok) {
    ElMessage.success('删除成功')
    await loadConfig()
  } else {
    const result = await response.json().catch(() => ({}))
    ElMessage.error(result.message || '删除失败')
  }
}

watch(
  () => accountForm.value.platform,
  (platform) => {
    if (!platform) return
    buildAccountAdapterFields(platform)
    syncAccountFormModel(accountOriginalConfig.value || {})
  }
)
</script>

<style lang="scss" scoped>
.page-scrollbar {
  height: 100%;

  :deep(.el-scrollbar__wrap) {
    overflow-x: hidden;
  }
}

.page-content {
  padding: 24px;
  min-height: 100%;
  background: var(--bg-color);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);

  h2 {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);

    .el-icon {
      color: var(--text-primary);
    }
  }
}

.config-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;

  :deep(.el-card__body) {
    padding: 0;
  }

  .config-textarea {
    :deep(textarea) {
      background: var(--card-bg);
      border: none;
      color: var(--text-primary);
      font-family: 'Courier New', 'Monaco', monospace;
      font-size: 13px;
      line-height: 1.6;
      padding: 16px;
      resize: none;

      &:focus {
        outline: none;
        box-shadow: none;
      }

      &::placeholder {
        color: var(--text-secondary);
      }
    }
  }
}

.schema-form {
  padding: 16px;
}

.schema-select {
  width: 240px;
}

.schema-input-number {
  width: 240px;
}

.schema-help {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.config-preview {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.static-pane {
  padding: 16px;
}

.static-alert {
  margin-bottom: 12px;
}

.static-toolbar {
  margin-bottom: 12px;
}

.static-root-hint {
  display: block;
  margin-bottom: 12px;
  font-size: 13px;
}

.static-path {
  font-size: 12px;
  word-break: break-all;
}
</style>
