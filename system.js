'use strict'

const Web3 = require('web3');
const web3 = new Web3(infura link);

const config = require('../config');
const MongoClient = require('mongodb').MongoClient;
const DbSystem = require('./dbs.js');
const DBs = new DbSystem();
const url = "mongodb://localhost:27017/";

const CoinGecko = require('coingecko-api');
const CoinGeckoClient = new CoinGecko();

const UserModel = require('./user');
const User = new UserModel();

function EthSystem(io){
  this.io = io;
  this.ethPrice;
  CoinGeckoClient.simple.price({ ids: ['ethereum'], vs_currencies: ['usd']})
  .then((data)=>{
    this.ethPrice = data.data.ethereum.usd;
  })
}



EthSystem.prototype.getAddress = function(userObject, callback){
  DBs.connectEthereumDB()
  .then((db)=>{
    db.collection('addresses').findOne({ user_id: userObject.id }, function(err, res) {
      if(!err){
        return callback(null, res)
      } else{
        return callback('There were no addresses found for that user', null)
      }
    })
  })
}

EthSystem.prototype.getAddressInfo = function(ethAddress, callback){
  DBs.connectEthereumDB()
  .then((db)=>{
    db.collection('addresses').findOne({ address: ethAddress }, function(err, res) {
      if(!err && res != null){
        return callback(null, res)
      } else{
        return callback('That address was not found.', null)
      }
    })
  })
}

EthSystem.prototype.updateAddress = function(userid, transaction, callback){
  DBs.connectEthereumDB()
  .then((db)=>{
    db.collection('addresses').updateOne({ user_id: userid }, { $addToSet: { transactions: transaction }, $inc: { totalDepositValue: Number(transaction.readableValue), totalDepositUsdValue: Number(transaction.usdValue) } }, function(err, res) {
      if (err) return callback(err, null)
      return callback(null, 'Address successfully updated')
    })
  })
}

EthSystem.prototype.generateAddress = function(userObject, callback){
  var addressData = web3.eth.accounts.create();
  DBs.connectEthereumDB()
  .then((db)=>{
    var myobj = {
      user_id: userObject.id,
      address: (addressData.address).toLowerCase(),
      private_key: addressData.privateKey,
      transactions: [],
      totalDepositValue: 0,
      totalDepositUsdValue: 0
    }
    db.collection('addresses').insertOne(myobj, function(err, res) {
      if (err) return callback(err, null)
      return callback(null, {
        address: (addressData.address).toLowerCase(),
        private_key: addressData.privateKey,
        transactions: [],
        totalDepositValue: 0,
        totalDepositUsdValue: 0
      })
    })
  })
}

EthSystem.prototype.checkBlock = function(block){
  web3.eth.getBlock(block.hash, true, (error, blockInfo)=>{
    if (!blockInfo || !blockInfo.transactions) {
      return;
    }
    blockInfo.transactions.forEach((transaction)=>{
      if(!transaction || !transaction.to){
        return;
      }
      this.getAddressInfo((transaction.to).toLowerCase(), (err, address)=>{
        if(!err){
          transaction.confirmations = block.number - transaction.blockNumber;
          transaction.readableValue = web3.utils.fromWei(transaction.value ,'ether');
          transaction.usdValue = (Number(this.ethPrice) * Number(transaction.readableValue)).toFixed(2);
          transaction.coinValue = transaction.usdValue * 1.8;
          this.updateAddress(address.user_id, transaction, (errr, updateInfo)=>{
            User.updateUserCoin(address.user_id, transaction.coinValue, (errorr, coinUpdateInfo)=>{
              if(!errorr){
                User.insertTransaction(address.user_id, {
                  amount: transaction.coinValue,
                  description: 'Ethereum Deposit',
                  date: new Date().toUTCString(),
                  timestamp: new Date().valueOf(),
                }, (transactionErr, transactionInfo)=>{
                  if(!transactionErr){
                    User.updateDeposited(address.user_id, Number(transaction.coinValue), (updateErr, updateRes)=>{
                      if(!updateErr){
                        this.io.emit('updateAllCoins', {
                          steamid: address.user_id,
                          amount: transaction.coinValue
                        })
                        this.io.emit('clientErrAll', {
                          steamid: address.user_id,
                          title: 'Success!',
                          desc: `Your deposit of ${transaction.readableValue} (${transaction.coinValue} coins) Ethereum was credited.`
                        })
                        User.updateStats({$inc: {totalDeposits: 1, totalDepositValue: Number(transaction.coinValue)}}, (updateErr, updateInfo)=>{
                          if(err) console.log(err)
                        })
                      }
                    })
                  }
                })
              }
            })
          })
        }
      })
    })
  })
}

EthSystem.prototype.startDepositCheck = function(){
  this.subscription = web3.eth.subscribe('newBlockHeaders', (error, block)=>{
    if(!error) {
      this.checkBlock(block)
    } else{
      console.log('error '+error)
    }
  })
}
