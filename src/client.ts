import { default as Axios, AxiosInstance } from 'axios'
import { createPoll } from './poll'
import { Config, Client, RequestIdResolver, PollCallback, StatusHandler, ValidationPayload } from './types'

let axiosClient: AxiosInstance = Axios

let requestIdResolver: RequestIdResolver = (config, axios) => `${config.method}:${config.baseURL ?? axios.defaults.baseURL ?? ''}${config.url}`

const abortControllers: { [key: string]: AbortController } = {}

export const client: Client = {
    get: (url, config = {}) => request({ ...config, url, method: 'get' }),
    post: (url, data = {}, config = {}) => request({ ...config, url, data, method: 'post' }),
    patch: (url, data = {}, config = {}) => request({ ...config, url, data, method: 'patch' }),
    put: (url, data = {}, config = {}) => request({ ...config, url, data, method: 'put' }),
    delete: (url, config = {}) => request({ ...config, url, method: 'delete' }),
    use(axios) {
        axiosClient = axios
        return this
    },
    useRequestIdResolver(callback) {
        requestIdResolver = callback
        return this
    },
    poll(callback: PollCallback) {
        return createPoll(callback, client)
    },
}

const request = (userConfig: Config = {}): Promise<unknown> => {
    const config = resolveConfig(userConfig)

    if (
        typeof config.requestId === 'string'
        && typeof config.signal === 'undefined'
        && typeof config.cancelToken === 'undefined'
    ) {
        abortControllers[config.requestId]?.abort()
        abortControllers[config.requestId] = new AbortController
        config.signal = abortControllers[config.requestId].signal
    }


    return axiosClient.request(config)
    .catch()
    .then(response => {
        if (response.headers.precognition !== 'true') {
            throw Error('Did not receive a Precognition response. Ensure you have the Precognition middleware in place for the route.')
        }

        const statusHandler = resolveStatusHandler(config, response.status)

        return statusHandler ? statusHandler(response) : response
    }, error => {
        if (! Axios.isAxiosError(error) || Axios.isCancel(error) || typeof error.response?.status !== 'number') {
            return Promise.reject(error)
        }

        if (error.response?.headers?.precognition !== 'true') {
            throw Error('Did not receive a Precognition response. Ensure you have the Precognition middleware in place for the route.')
        }

        if (error.response.status === 422 && config.onValidationError && isValidationPayload(error.response.data)) {
            return config.onValidationError(error.response.data.errors, error)
        }

        const statusHandler = resolveStatusHandler(config, error.response.status)

        return statusHandler ? statusHandler(error.response, error) : Promise.reject(error)
    })
}

const resolveConfig = (config: Config): Config => ({
    requestId: typeof config.requestId === 'undefined'
        ? requestIdResolver(config, axiosClient)
        : config.requestId,
    ...config,
    headers: {
        ...config.headers,
        Precognition: true,
        ...config.validate ? {
            'Precognition-Validate-Only': Array.from(config.validate).join(),
        } : {},
    },
})

const resolveStatusHandler = (config: Config, code: number): StatusHandler|undefined => ({
    204: config.onPrecognitionSuccess,
    401: config.onUnauthorized,
    403: config.onForbidden,
    404: config.onNotFound,
    409: config.onConflict,
    423: config.onLocked,
}[code])

const isValidationPayload = (response: any): response is ValidationPayload => {
    return typeof response === 'object'
       && typeof response.message === 'string'
       && typeof response.errors === 'object'
       && ! Array.isArray(response.errors)
       && Object.keys(response.errors).every(key => {
           return Array.isArray(response.errors[key])
               && response.errors[key].every((error: unknown) => typeof error === 'string')
       })
}
