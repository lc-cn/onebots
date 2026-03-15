<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><User /></el-icon>
          账号管理
        </h2>
        <el-space>
          <el-button type="primary" :icon="Plus" @click="openAdd">
            添加账号
          </el-button>
          <el-button type="success" :icon="Refresh" @click="loadAccounts">
            刷新
          </el-button>
        </el-space>
      </div>

      <el-card shadow="never" class="accounts-card">
        <el-table :data="accounts" style="width: 100%" :empty-text="emptyText">
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
                <el-button size="small" type="primary" @click="openEdit(scope.row)">
                  编辑
                </el-button>
                <el-button size="small" type="danger" @click="handleRemove(scope.row)">
                  删除
                </el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-dialog v-model="dialogVisible" :title="dialogTitle" width="760px">
        <el-form :model="form" label-width="120px">
          <el-form-item label="平台" required>
            <el-input v-model="form.platform" placeholder="例如: qq" />
          </el-form-item>
          <el-form-item label="账号ID" required>
            <el-input v-model="form.account_id" placeholder="例如: my_bot" />
          </el-form-item>
        </el-form>
        <el-divider>协议配置</el-divider>
        <el-collapse v-model="activeProtocolGroups">
          <el-collapse-item
            v-for="group in protocolGroups"
            :key="group.key"
            :name="group.key"
          >
            <template #title>
              <el-space>
                <el-switch v-model="protocolEnabled[group.key]" size="small" />
                <span>{{ group.title }}</span>
              </el-space>
            </template>
            <el-form :model="formModel" label-width="140px" class="schema-section">
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
                  :disabled="!protocolEnabled[group.key]"
                />
                <el-input-number
                  v-else-if="field.rule.type === 'number'"
                  v-model="formModel[field.key]"
                  :min="field.rule.min"
                  :max="field.rule.max"
                  controls-position="right"
                  class="schema-input-number"
                  :disabled="!protocolEnabled[group.key]"
                />
                <el-switch
                  v-else-if="field.rule.type === 'boolean'"
                  v-model="formModel[field.key]"
                  :disabled="!protocolEnabled[group.key]"
                />
                <el-select
                  v-else-if="field.rule.enum"
                  v-model="formModel[field.key]"
                  class="schema-select"
                  :disabled="!protocolEnabled[group.key]"
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
                  :disabled="!protocolEnabled[group.key]"
                />
                <el-input
                  v-else
                  v-model="formModel[field.key]"
                  :placeholder="field.placeholder"
                  :disabled="!protocolEnabled[group.key]"
                />
                <el-text v-if="field.rule.description" class="schema-help">
                  {{ field.rule.description }}
                </el-text>
              </el-form-item>
            </el-form>
          </el-collapse-item>
        </el-collapse>

        <el-divider>平台配置</el-divider>
        <el-form v-if="adapterFields.length" :model="formModel" label-width="140px" class="schema-section">
          <el-form-item
            v-for="field in adapterFields"
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
        <el-empty v-else description="暂无平台 Schema" />
        <template #footer>
          <el-space>
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="handleSubmit">保存</el-button>
          </el-space>
        </template>
      </el-dialog>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { User, Plus, Refresh } from '@element-plus/icons-vue'
import yaml from 'js-yaml'
import { buildApiUrl } from '../config'
import { authFetch } from '../composables/useAuth'

type AccountRow = {
  key: string
  platform: string
  account_id: string
  config: Record<string, any>
  preview: string
}

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

const accounts = ref<AccountRow[]>([])
const emptyText = ref('暂无账号')
const dialogVisible = ref(false)
const dialogTitle = ref('添加账号')
const isEdit = ref(false)
const editingKey = ref<string | null>(null)
const schema = ref<SchemaBundle | null>(null)
const protocolGroups = ref<SchemaGroup[]>([])
const adapterFields = ref<SchemaField[]>([])
const activeProtocolGroups = ref<string[]>([])
const protocolEnabled = reactive<Record<string, boolean>>({})
const formModel = reactive<Record<string, any>>({})
const originalConfig = ref<Record<string, any>>({})

const form = ref({
  platform: '',
  account_id: ''
})

const makeKey = (path: string[]) => path.join('::')

const isRule = (rule: ValidationRule | Schema): rule is ValidationRule => {
  return typeof rule === 'object' && ('type' in rule || 'required' in rule || 'enum' in rule || 'default' in rule)
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

const normalizeSchema = (data: Schema | SchemaBundle): SchemaBundle => {
  if ('base' in data || 'general' in data || 'protocols' in data || 'adapters' in data) {
    return data as SchemaBundle
  }
  return { base: data as Schema }
}

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

const buildProtocolGroups = () => {
  if (!schema.value?.protocols) {
    protocolGroups.value = []
    return
  }
  const groups: SchemaGroup[] = []
  Object.entries(schema.value.protocols).forEach(([protocolKey, protocolSchema]) => {
    groups.push({
      key: protocolKey,
      title: protocolKey,
      fields: buildSchemaFields(protocolSchema, [protocolKey])
    })
    if (protocolEnabled[protocolKey] === undefined) {
      protocolEnabled[protocolKey] = false
    }
  })
  protocolGroups.value = groups
  activeProtocolGroups.value = groups.map(group => group.key)
}

const buildAdapterFields = (platform: string) => {
  const adapterSchema = schema.value?.adapters?.[platform]
  if (!adapterSchema) {
    adapterFields.value = []
    return
  }
  adapterFields.value = buildSchemaFields(adapterSchema, [])
}

const syncFormModel = (configObject: Record<string, any>) => {
  protocolGroups.value.forEach((group) => {
    const enabled = Boolean(configObject[group.key])
    protocolEnabled[group.key] = enabled
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

  adapterFields.value.forEach((field) => {
    const currentValue = getValueByPath(configObject, field.path)
    if (field.rule.type === 'object' || field.rule.type === 'array') {
      const baseValue = currentValue ?? field.rule.default ?? (field.rule.type === 'array' ? [] : {})
      formModel[field.key] = JSON.stringify(baseValue, null, 2)
      return
    }
    formModel[field.key] = currentValue ?? field.rule.default ?? (field.rule.type === 'boolean' ? false : '')
  })
}

const loadAccounts = async () => {
  try {
    const response = await authFetch(buildApiUrl('/api/config'))
    if (!response.ok) {
      ElMessage.error('加载配置失败')
      return
    }
    const text = await response.text()
    const configObject = (yaml.load(text) || {}) as Record<string, any>
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
    emptyText.value = rows.length ? '' : '暂无账号'
  } catch (error) {
    console.error('加载账号失败:', error)
    ElMessage.error('加载账号失败')
  }
}

const loadSchema = async () => {
  try {
    const response = await authFetch(buildApiUrl('/api/config/schema'))
    if (response.ok) {
      const raw = await response.json()
      schema.value = normalizeSchema(raw)
      buildProtocolGroups()
    }
  } catch (error) {
    console.error('加载 Schema 失败:', error)
  }
}

const openAdd = () => {
  dialogTitle.value = '添加账号'
  isEdit.value = false
  editingKey.value = null
  originalConfig.value = {}
  form.value = {
    platform: '',
    account_id: ''
  }
  buildAdapterFields('')
  syncFormModel({})
  dialogVisible.value = true
}

const openEdit = (row: AccountRow) => {
  dialogTitle.value = '编辑账号'
  isEdit.value = true
  editingKey.value = row.key
  originalConfig.value = JSON.parse(JSON.stringify(row.config || {}))
  form.value = {
    platform: row.platform,
    account_id: row.account_id
  }
  buildAdapterFields(row.platform)
  syncFormModel(row.config || {})
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!form.value.platform || !form.value.account_id) {
    ElMessage.warning('请填写平台与账号ID')
    return
  }

  const configObject = JSON.parse(JSON.stringify(originalConfig.value || {}))

  for (const group of protocolGroups.value) {
    if (!protocolEnabled[group.key]) {
      delete configObject[group.key]
      continue
    }
    for (const field of group.fields) {
      let value = formModel[field.key]
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

  for (const field of adapterFields.value) {
    let value = formModel[field.key]
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
    platform: form.value.platform,
    account_id: form.value.account_id
  }

  const url = isEdit.value ? '/api/edit' : '/api/add'
  const response = await authFetch(buildApiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (response.ok) {
    ElMessage.success('保存成功')
    dialogVisible.value = false
    await loadAccounts()
  } else {
    const result = await response.json().catch(() => ({}))
    ElMessage.error(result.message || '保存失败')
  }
}

const handleRemove = async (row: AccountRow) => {
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
    await loadAccounts()
  } else {
    const result = await response.json().catch(() => ({}))
    ElMessage.error(result.message || '删除失败')
  }
}

watch(
  () => form.value.platform,
  (platform) => {
    if (!platform) return
    buildAdapterFields(platform)
    syncFormModel(originalConfig.value || {})
  }
)

loadSchema().finally(loadAccounts)
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

.accounts-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;

  :deep(.el-card__body) {
    padding: 0;
  }
}

.config-preview {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.schema-section {
  padding: 8px 0;
}

.schema-help {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.schema-select,
.schema-input-number {
  width: 240px;
}
</style>
