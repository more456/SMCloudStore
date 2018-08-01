'use strict'

const Azure = require('azure-storage')

/**
 * Connection options for an Azure provider.
 * @typedef {Object} AzureConnectionOptions
 * @param {string} connectionString - Connection String, as returned by Azure
 */
/**
 * Dictionary of objects returned when listing a container.
 * 
 * @typedef {Object} ListItemObject
 * @param {string} path - Full path of the object inside the container
 * @param {Date} lastModified - Date when the object was last modified
 * @param {number} size - Size in bytes of the object
 */
/**
 * Dictionary of prefixes returned when listing a container.
 * 
 * @typedef {Object} ListItemPrefix
 * @param {string} prefix - Name of the prefix
 */
/**
 * The `listObjects` method returns an array with a mix of objects of type `ListItemObject` and `ListItemPrefix`
 * @typedef {Array<ListItemObject|ListItemPrefix>} ListResults
 */

/**
 * @class AzureProvider
 * Client to interact with Azure Blob Storage.
 */
class AzureProvider {
    /**
     * Initializes a new client to interact with Azure Blob Storage.
     * 
     * @param {AzureConnectionOptions} connection - Dictionary with connection options.
     */
    constructor(connection) {
        // The Azure library will validate the connection object
        this._azure = Azure.createBlobService(connection)
    }

    /**
     * Create a container on the server.
     * 
     * @param {string} container - Name of the container
     * @param {string} [region] - The region parameter is ignored by Azure.
     * @returns {Promise<void>} Promise that resolves once the container has been created. The promise doesn't contain any meaningful return value.
     * @async
     */
    createContainer(container, region) {
        return this._createContainerInternal(container, false)
    }

    /**
     * Check if a container exists.
     * 
     * @param {string} container - Name of the container
     * @returns {Promise<boolean>} Promises that resolves with a boolean indicating if the container exists.
     * @async
     */
    containerExists(container) {
        return new Promise((resolve, reject) => {
            this._azure.getContainerProperties(container, (err, response) => {
                if (err) {
                    // If error is "Not Found", then just return false
                    return err.toString().match(/NotFound/) ?
                        resolve(false) :
                        reject(err)
                }
                else if (response && response.name) {
                    return resolve(true)
                }
                else {
                    throw Error('Response does not contain storage account name')
                }
            })
        })
    }

    /**
     * Create a container on the server if it doesn't already exist.
     * 
     * @param {string} container - Name of the container
     * @param {string} [region] - The region parameter is ignored by Azure.
     * @returns {Promise<void>} Promise that resolves once the container has been created
     * @async
     */
    ensureContainer(container, region) {
        return this._createContainerInternal(container, true)
    }

    /**
     * Lists all containers belonging to the user
     * 
     * @returns {Promise<string[]>} Promise that resolves with an array of all the containers
     * @async
     */
    listContainers() {
        const resultList = []

        // The response might be split into multiple pages, so we need to be prepared to make multiple requests and use a continuation token
        const requestPromise = (continuationToken) => {
            return new Promise((resolve, reject) => {
                this._azure.listContainersSegmented(continuationToken, {maxResults: 2}, (err, response) => {
                    if (err) {
                        return reject(err)
                    }
                    
                    // Iterate through entries
                    if (!response.entries || !Array.isArray(response.entries)) {
                        throw Error('Response does not contain an entries array')
                    }
                    for (const i in response.entries) {
                        const e = response.entries[i]
                        if (!e || !e.name) {
                            throw Error('Invalid entry')
                        }
                        resultList.push(e.name)
                    }
 
                    // Check if we have a continuation token
                    if (response.continuationToken) {
                        // We have a token, so need to make another request, returning a promise
                        resolve(requestPromise(response.continuationToken))
                    }
                    else {
                        // No token, so return the list of what we've collected
                        resolve(resultList)
                    }
                })
            })
        }

        return requestPromise(null)
    }

    /**
     * Removes a contaienr from the server
     * 
     * @param {string} container - Name of the container
     * @returns {Promise<void>} Promise that resolves once the container has been removed
     * @async
     */
    deleteContainer(container) {
        return new Promise((resolve, reject) => {
            this._azure.deleteContainer(container, (err, response) => {
                if (err) {
                    return reject(err)
                }
                else if (!response || !response.isSuccessful) {
                    throw Error('Response was empty or not successful')
                }
                else {
                    return resolve()
                }
            })
        })
    }

    /**
     * Uploads a stream to the object storage server
     * 
     * @param {string} container - Name of the container
     * @param {string} path - Path where to store the object, inside the container
     * @param {Stream|string|Buffer} data - Object data or stream. Can be a Stream (Readable Stream), Buffer or string.
     * @param {Object} [metadata] - Key-value pair with metadata for the object, for example `Content-Type` or custom tags
     * @returns {Promise<void>} Promise that resolves once the object has been uploaded
     * @async
     */
    putObject(container, path, data, metadata) {
        if (!data) {
            throw Error('Argument data is empty')
        }

        // Azure wants some headers, like Content-Type, outside of the metadata object
        const contentSettings = {}
        if (metadata) {
            if (metadata['Content-Type']) {
                contentSettings.contentType = metadata['Content-Type']
                delete metadata['Content-Type']
            }
            if (metadata['Content-Encoding']) {
                contentSettings.contentEncoding = metadata['Content-Encoding']
                delete metadata['Content-Encoding']
            }
            if (metadata['Content-Language']) {
                contentSettings.contentLanguage = metadata['Content-Language']
                delete metadata['Content-Language']
            }
            if (metadata['Cache-Control']) {
                contentSettings.cacheControl = metadata['Cache-Control']
                delete metadata['Cache-Control']
            }
            if (metadata['Content-Disposition']) {
                contentSettings.contentDisposition = metadata['Content-Disposition']
                delete metadata['Content-Disposition']
            }
            if (metadata['Content-MD5']) {
                // Content-MD5 is auto-generated if not sent by the user
                // If sent by the user, then Azure uses it to ensure data did not get altered in transit
                contentSettings.contentMD5 = metadata['Content-MD5']
                delete metadata['Content-MD5']
            }
        }
        const options = {
            metadata,
            contentSettings
        }

        return new Promise((resolve, reject) => {
            const callback = (err, response) => {
                if (err) {
                    return reject(err)
                }
                // When uploading a string or Buffer, we have a complex object; for a stream, we just have a list of committedBlocks in the response
                if (!response || (!response.name && !response.commmittedBlocks)) {
                    throw Error('Response was empty or not successful')
                }
                else {
                    return resolve()
                }
            }

            // Check if we have a stream
            if (typeof data == 'object' && typeof data.pipe == 'function') {
                data.pipe(this._azure.createWriteStreamToBlockBlob(container, path, options, callback))
            }
            // Strings and Buffers are supported too
            else if (typeof data == 'string' || (typeof data == 'object' && Buffer.isBuffer(data))) {
                this._azure.createBlockBlobFromText(container, path, data, options, callback)
            }
            // Fail otherwise
            else {
                throw Error('Argument data must be a Stream, a String or a Buffer')
            }
        })
    }

    /**
     * Requests an object from the server. The method returns a Promise that resolves to a Readable Stream containing the data.
     * 
     * @param {string} container - Name of the container
     * @param {string} path - Path of the object, inside the container
     * @returns {Promise<Stream>} Readable Stream containing the object's data
     * @async
     */
    getObject(container, path) {
    }

    /**
     * Returns a list of objects with a given prefix (folder). The list is not recursive, so prefixes (folders) are returned as such.
     * 
     * @param {string} container - Name of the container
     * @param {string} prefix - Prefix (folder) inside which to list objects
     * @returns {Promise<ListResults>} List of elements returned by the server
     * @async
     */
    listObjects(container, prefix) {
    }

    /**
     * Removes an object from the server
     * 
     * @param {string} container - Name of the container
     * @param {string} path - Path of the object, inside the container
     * @returns {Promise<void>} Promise that resolves once the object has been removed
     * @async
     */
    removeObject(container, path) {
    }

    /* Internal methods */

    /**
     * Create a container on the server, choosing whether to use the "ifNotExists" method or not
     * @param {string} container - Name of the container
     * @param {boolean} ifNotExists - If true, use the "ifNotExists" method variant
     * @returns {Promise<void>} Promise that resolves once the container has been created. The promise doesn't contain any meaningful return value.
     * @private
     * @async
     */
    _createContainerInternal(container, ifNotExists) {
        return new Promise((resolve, reject) => {
            const options = {
                // All containers are private by default
                publicAccessLevel: null
            }
            this._azure['createContainer' + (ifNotExists ? 'IfNotExists' : '')](container, options, (err, response) => {
                if (err) {
                    return reject(err)
                }
                else if (response && response.name) {
                    return resolve(true)
                }
                else {
                    throw Error('Response does not contain storage account name')
                }
            })
        })
    }
}

module.exports = AzureProvider