import React, { Component } from "react";
import { BootstrapTable, TableHeaderColumn } from "react-bootstrap-table";
import "react-bootstrap-table/dist/react-bootstrap-table.min.css";
import fetchWithRetries from "./FetchWithRetries";
import Inspector from "react-inspector";

import {
  Button,
  Checkbox,
  FormControl,
  FormGroup,
  ControlLabel,
  ButtonToolbar,
  Alert,
  DropdownButton,
  MenuItem
} from "react-bootstrap";
import Networks from "./Networks";
import { findAddress, initialize } from "./PathFinderUtils";
import Errors from "./Errors";
import HDAddress from "./HDAddress";
import {
  estimateTransactionSize,
  createPaymentTransaction
} from "./TransactionUtils";

const initialState = {
  done: false,
  running: false,
  coin: "105",
  error: false,
  segwit: false,
  path: "44'/105'/0'",
  useXpub: false,
  xpub58: "",
  gap: 2,
  result: [],
  allTxs: {},
  paused: false,
  lastIndex: [0, 0],
  totalBalance: 0,
  selectedTotal: 0,
  selectedAddresses: [],
  selectedUtxos: []
};

class MultiAddressWithdraw extends Component {
  hdAddress = new HDAddress();
  
  constructor(props) {
    super();
    if (localStorage.getItem("LedgerBalanceChecker")) {
      this.state = JSON.parse(localStorage.getItem("LedgerBalanceChecker"));
    } else {
      this.state = initialState;
    }
  }

  componentWillUnmount() {
    var state = {};
    this.interrupt();
    if (this.state.running) {
      Object.assign(state, this.state, {
        running: false,
        paused: true
      });
    } else {
      Object.assign(state, this.state); 
    }
    localStorage.setItem("LedgerBalanceChecker", JSON.stringify(state));
  }

  reset = () => {
    // change states.
    localStorage.removeItem("LedgerBalanceChecker");
    this.setState({
      result: [],
      allTxs: {},
      paused: false,
      lastIndex: [0, 0],
      totalBalance: 0,
      done: false,
      running: false,
      error: false,
      selectedAddresses: [],
      selectedTotal: 0,
      currentPathBeingChecked:""
    });
  };

  onError = e => {
    console.log("on error", e);
    this.reset();
    this.setState({
      error: e.toString()
    });
  };

  handleChangePath = e => {
    this.reset();
    this.setState({
      path: e.target.value.replace(/\s/g, ""),
      done: false,
      result: []
    });
  };

  handleChangeGap = e => {
    this.reset();
    this.setState({ gap: e.target.value });
  };

  handleChangeSegwit = e => {
    this.reset();
    let isSegwit = e.target.checked;
    this.setState({ 
      segwit: isSegwit,
      path: `${this.hdAddress.getPath(isSegwit, this.state.coin, this.state.path)}`,
    });
  };

  handleChangeUseXpub = e => {
    this.reset();
    this.setState({ useXpub: e });
  };

  handleChangeXpub = e => {
    this.reset();
    this.setState({
      xpub58: e.target.value.replace(/\s/g, "")
    });
  };

  handleChangeCoin = e => {
    this.reset();
    this.setState({ 
      coin: e.target.value,
      path: `${this.hdAddress.getPath(this.state.isSegwit, e.target.value, this.state.path)}`,
    });
  };

  handleChangeDestinationAddress = e => {
    this.setState({ 
      destinationAddress: e.target.value.replace(/\s/g, "")
    });
  };

  onUpdate = (e, i, j) => {
    const internalAddress = j === 0;
    const changeAddress = j === 1;

    const noTransactionsAtAddress = Object.keys(this.state.allTxs[e.address]).length === 0;
    if (!this.state.destinationAddress && internalAddress && noTransactionsAtAddress)
    {
       this.setState({destinationAddress: e.address});
    }
    if (!this.state.changePath && changeAddress && noTransactionsAtAddress)
    {
       this.setState({changePath: e.path});
    }

    this.setState({
      currentPathBeingChecked: e.path
    });
  
    if (e.balance > 0) {
      this.setState({
        result: this.state.result.concat(e), lastIndex: [i, j]
      
      });
      this.prepare (e, e.address);
    }
  };

  interrupt = () => {
    this.stop = true;
  };

  addressesOptions = {
    onRowClick: row => {
      if (!this.state.running) {
        if (this.state.allTxs[row.address]) {
          this.setState({
            selectedTxs: Object.keys(this.state.allTxs[row.address]).map(
              tx => this.state.allTxs[row.address][tx].display
            ),
            selectedAddress: row.address,
            selectedTx: false
          });
        } else {
          this.setState({
            selectedTxs: false,
            selectedAddress: false,
            selectedTx: false
          });
        }
      }
    }
  };

  txsOptions = {
    onRowClick: (tx, col, row) => {
      this.setState({
        selectedTx: tx.raw
      });
    }
  };

  recover = async e => {
    let [i, j] = this.state.lastIndex;
    this.stop = false;
    e.preventDefault();
    let total = this.state.totalBalance;
    let allTxs = this.state.allTxs;
    this.setState({
      running: true,
      paused: false,
      done: false,
      error: false,
      selectedTxs: false,
      selectedTx: false
    });
    try {
      var emptyStreak = 0;
      let xpub58 = this.state.useXpub
        ? this.state.xpub58
        : await initialize(
            this.state.coin,
            this.state.path.split("/")[0],
            this.state.path.split("/")[1],
            this.state.path.split("/")[2],
            this.state.segwit
          );
      console.log("xpub is", xpub58);
      const iterate = async (txs, address, balance, blockHash = "") => {
        const res = await fetchWithRetries(apiPath + blockHash);
        const data = await res.json();
        txs = txs.concat(data.txs);
        if (!data.truncated) {
          if (data.txs.length < 1 && j === 0) {
            emptyStreak++;
            allTxs[address] = {};
            return 0;
          } else {
            allTxs[address] = {};
            txs.forEach(tx => {
              let localBalance = 0;
              tx.outputs.forEach(output => {
                if (output.address === address) {
                  localBalance += output.value;
                }
              });
              tx.inputs.forEach(input => {
                if (input.address === address) {
                  localBalance -= input.value;
                }
              });
              balance += localBalance;
              allTxs[address][tx.hash] = {
                display: {
                  time: tx.received_at,
                  balance:
                    (
                      localBalance /
                      10 ** Networks[this.state.coin].satoshi
                    ).toString() +
                    " " +
                    Networks[this.state.coin].unit,
                  hash: tx.hash,
                  raw: tx
                }
              };
            });
          }
        } else {
          return await iterate(
            txs,
            address,
            balance,
            "&blockHash=" + data.txs[data.txs.length - 1].block.hash
          );
        }
        return balance;
      };
      for (i; emptyStreak < this.state.gap; i++) {
        if (this.state.error) {
          break;
        }
        for (j; j < 2; j++) {
          if (this.stop) {
            throw "stopped";
          }
          let localPath = [this.state.path, j, i].join("/");
          let address;
          try {
            address = await findAddress(
              localPath,
              this.state.segwit,
              this.state.coin,
              xpub58
            );
          } catch (e) {
            console.log(e);
            throw Errors.u2f;
          }
          try {
            var apiPath =
              "https://api.ledgerwallet.com/blockchain/v2/" +
              Networks[this.state.coin].apiName +
              "/addresses/" +
              address +
              "/transactions?noToken=true";
            let balance = await iterate([], address, 0);
            total += balance;
            this.onUpdate(
              {
                path: localPath,
                address,
                balance:
                  (
                    balance /
                    10 ** Networks[this.state.coin].satoshi
                  )
              },
              i,
              j
            );
          } catch (e) {
            throw Errors.networkError;
          }
        }
        j = 0;
      }
      this.setState({
        running: false,
        done: true,
        allTxs,
        selectedTxs: false,
        totalBalance: total
      });
    } catch (e) {
      if (!(e === "stopped")) {
        this.onError(e);
      } else {
        this.setState({
          running: false,
          paused: true,
          allTxs,
          selectedTxs: false,
          totalBalance: total
        });
      }
    }
  };
  getFees = async () => {
    try {
      var path =
        "https://api.ledgerwallet.com/blockchain/v2/" +
        Networks[this.state.coin].apiName +
        "/fees";
      let response = await fetchWithRetries(path);
      let data = await response.json();
      this.setState({ standardFees: data });
    } catch (e) {}
  };

  prepare = async (e, address) => {
    //e.preventDefault();
    // this.setState({
    //   running: true,
    //   prepared: false,
    //   done: false,
    //   empty: false,
    //   error: false
    // });
    alert(address);
    let txs = [];
    let spent = {};
    try {
      await this.getFees();
    } catch (e) {
      this.onError(Errors.u2f);
    }
    try {
      var apiPath =
        "https://api.ledgerwallet.com/blockchain/v2/" +
        Networks[this.state.coin].apiName +
        "/addresses/" +
        address +
        "/transactions?noToken=true";
      alert(apiPath);
      console.log(apiPath);
      const iterate = async (blockHash = "") => {
        const res = await fetchWithRetries(apiPath + blockHash);
        const data = await res.json();
        txs = txs.concat(data.txs);
        if (!data.truncated) {
          console.log(txs);
          var utxos = {};
          txs.forEach(tx => {
            tx.inputs.forEach(input => {
              if (input.address === address) {
                if (!spent[input.output_hash]) {
                  spent[input.output_hash] = {};
                }
                spent[input.output_hash][input.output_index] = true;
              }
            });
          });
          txs.forEach(tx => {
            tx.outputs.forEach(output => {
              if (output.address === address) {
                if (!spent[tx.hash]) {
                  spent[tx.hash] = {};
                }
                if (!spent[tx.hash][output.output_index]) {
                  if (!utxos[tx.hash]) {
                    utxos[tx.hash] = {};
                  }
                  utxos[tx.hash][output.output_index] = tx;
                }
              }
            });
          });
          return [utxos, address];
        } else {
          return await iterate(
            "&blockHash=" + data.txs[data.txs.length - 1].block.hash
          );
        }
      };
      let d = await iterate();
      this.onPrepared(d);
    } catch (e) {
      this.onError(Errors.networkError);
    }
  };

  onPrepared = d => {
    console.log("preparing utxos etc......")
    const utxos = d[0];
    let balance = 0;
    let inputs = 0;
    for (var utxo in utxos) {
      if (utxos.hasOwnProperty(utxo)) {
        for (var index in utxos[utxo]) {
          if (utxos[utxo].hasOwnProperty(index)) {
            balance += utxos[utxo][index].outputs[index].value;
            inputs++;
          }
        }
      }
    }
    if (balance <= 0) {
      this.setState({
        empty: true,
        prepared: true,
        running: false,
        //balance: balance,
        address: d[1]
      });
    } else {
      let txSize = Networks[this.state.coin].handleFeePerByte
        ? estimateTransactionSize(inputs, 1, this.state.segwit).max
        : Math.floor(
            estimateTransactionSize(inputs, 1, this.state.segwit).max / 1000
          ) + 1;
      
          const localUtxoDebug = "current uxto:" + JSON.stringify(utxos);
          alert(localUtxoDebug);
          console.log(localUtxoDebug);

      this.setState({
        empty: false,
        txSize,
        prepared: true,
        running: false,
        selectedUtxos: Object.assign({}, this.state.selectedUtxos, utxos),
        //balance: balance,
        //address: d[1],
        customFeesVal: 0,
        fees:
          txSize * this.state.standardFees[6] < balance
            ? txSize * this.state.standardFees[6]
            : 0,
        customFees: txSize * this.state.standardFees[6] >= balance
      });
      const stateUtxoDebug = "in state:" + JSON.stringify(this.state.selectedUtxos);
      alert(stateUtxoDebug);
      console.log(stateUtxoDebug);
    }
  };

  transfer = async () => {
    this.setState({ running: true, done: false, error: false });
    try {
      let tx;
      tx = await createPaymentTransaction(
        this.state.destinationAddress,
        (this.state.selectedTotal * 10 ** Networks[this.state.coin].satoshi) - (this.state.fees*1000),
        this.state.selectedUtxos,
        this.state.changePath,
        this.state.coin
      );
      var body = JSON.stringify({
        tx: tx
      });
      alert(body);
      console.log(body);
      
      var path =
        "https://api.ledgerwallet.com/blockchain/v2/" +
        Networks[this.state.coin].apiName +
        "/transactions/send";
      console.log("res", tx);
      let res;
      try {
        res = await fetchWithRetries(path, {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": JSON.stringify(body).length
          },
          method: "post",
          body
        });
        if (!res.ok) {
          throw "not ok";
        }
      } catch (e) {
        if (e == "not ok") {
          let err = await res.text();
          err = JSON.parse(err);
          console.log(err);
          err = JSON.parse(err.error);
          throw Errors.sendFail + err.error.message;
        } else {
          throw Errors.networkError;
        }
      }
      this.onSent(res);
    } catch (e) {
      this.onError(e);
    }
  };

  onSent = async tx => {
    let error = false;
    const json = await tx.json();
    if (!json) {
      console.log(error);
      error = tx;
    }
    this.setState({
      prepared: false,
      running: false,
      done: json.result,
      error
    });
  };

  
  render() {
    let derivations = ["Derive from device", "Derive from XPUB"];

    var coinSelect = [];
    for (var coin in Networks) {
      if (Networks.hasOwnProperty(coin)) {
        coinSelect.push(
          <option value={coin} key={coin} selected={coin === this.state.coin}>
            {Networks[coin].name}
          </option>
        );
      }
    }

    const selectRow = {
      mode: 'checkbox',
      clickToSelect: true,
      onSelect: (row, isSelect, x, rowIndex) => {
        var selectedTotal = this.state.selectedTotal;
        var selectedAddresses = this.state.selectedAddresses;
        if (isSelect)
        {
          selectedTotal += row.balance;
          selectedAddresses.push({address: row.address});
        }
        else
        {
          selectedTotal -= row.balance;

          for(var i=0; i < selectedAddresses.length; i++)
          {
            if (selectedAddresses[i].address === row.address) {
              selectedAddresses.splice(i,1);
              break;
            }
          }
        }

        this.setState({
         selectedTotal: selectedTotal,
         selectedAddresses: selectedAddresses
        })
      },
      onSelectAll: (isSelect, rows, e) => {
        if (!isSelect)
        {
          this.setState({
            selectedTotal: 0,
            selectedAddresses: []
           })
           return;
        }
        var selectedTotal = 0;
        var selectedAddresses = this.state.selectedAddresses;

        for (var i = 0; i < rows.length; i++)
        {
            selectedTotal += rows[i].balance
            selectedAddresses.push({address: rows[i].address});
        }
        this.setState({
          selectedTotal: selectedTotal,
          selectedAddresses: selectedAddresses
        })
      }
    };

    return (
      <div className="MultiAddressWithdraw">
        <form onSubmit={this.recover}>
          <FormGroup controlId="MultiAddressWithdraw">
            <DropdownButton
              title={this.state.useXpub ? derivations[1] : derivations[0]}
              disabled={this.state.running || this.state.paused}
              bsStyle="primary"
              bsSize="large"
              style={{ marginBottom: "15px" }}
            >
              <MenuItem onClick={() => this.handleChangeUseXpub(false)}>
                {" "}
                {derivations[0]}{" "}
              </MenuItem>
              <MenuItem onClick={() => this.handleChangeUseXpub(true)}>
                {" "}
                {derivations[1]}{" "}
              </MenuItem>
            </DropdownButton>
            <br />
            {this.state.useXpub && (
              <div>
                <ControlLabel>XPUB</ControlLabel>
                <FormControl
                  type="text"
                  value={this.state.xpub58}
                  onChange={this.handleChangeXpub}
                  disabled={this.state.running || this.state.paused}
                />
              </div>
            )}
            <ControlLabel>Currency</ControlLabel>
            <FormControl
              componentClass="select"
              placeholder="select"
              onChange={this.handleChangeCoin}
              disabled={this.state.running || this.state.paused}
            >
              {coinSelect}
            </FormControl>
            <Checkbox
              onChange={this.handleChangeSegwit}
              checked={this.state.segwit}
              disabled={this.state.running || this.state.paused}
            >
              Segwit
            </Checkbox>
            <ControlLabel>Path</ControlLabel>
            <FormControl
              type="text"
              value={this.state.path}
              placeholder="44'/0'/0'"
              onChange={this.handleChangePath}
              disabled={this.state.running || this.state.paused}
            />
            <FormControl.Feedback />
            <ControlLabel>Gap</ControlLabel>
            <FormControl
              type="number"
              value={this.state.gap}
              onChange={this.handleChangeGap}
              disabled={this.state.running || this.state.paused}
            />
            <br />
            <ButtonToolbar style={{ marginTop: "10px" }}>
              {!this.state.running &&
                !this.state.paused &&
                !this.state.done && (
                  <Button bsSize="large" onClick={this.recover}>
                    Recover account's balances
                  </Button>
                )}
              {this.state.running && (
                <Button bsSize="large" onClick={this.interrupt}>
                  Pause
                </Button>
              )}
              {!this.state.running &&
                this.state.paused && (
                  <Button bsSize="large" onClick={this.recover}>
                    Continue
                  </Button>
                )}
              <Button
                bsSize="large"
                onClick={this.reset}
                disabled={this.state.running}
              >
                Reset
              </Button>
              <p>{(this.state.done || this.state.paused) || this.state.currentPathBeingChecked}</p>
            </ButtonToolbar>
          </FormGroup>
          {this.state.error && (
            <Alert bsStyle="danger">
              <strong>Operation aborted</strong>
              <p>{this.state.error}</p>
            </Alert>
          )}
          {this.state.done && (
            
            <Alert bsStyle="success">
              <strong>Synchronization finished</strong>
              <p>
                Total on this account:{" "}
                {(
                  this.state.totalBalance /
                  10 ** Networks[this.state.coin].satoshi
                ).toString() +
                  " " +
                  Networks[this.state.coin].unit}
              </p>
              
            </Alert>
            
            
          )}
          {this.state.done && this.state.selectedAddresses && this.state.selectedAddresses.length>0 && (
            <div>
            <p>
            Selected total:{" "}
            {(
              this.state.selectedTotal 
            ).toString() +
              " " +
              Networks[this.state.coin].unit}
            </p>
            <p>
            Fees:{" "}
            {this.state.fees /
                    10 ** Networks[this.state.coin].satoshi}{" "}
                  {Networks[this.state.coin].unit}
            </p>
          {/* <BootstrapTable
            data={this.state.selectedAddresses} >
                <TableHeaderColumn dataField="address" isKey={true}>
            Address
                 </TableHeaderColumn>
          </BootstrapTable> */}
          <ControlLabel>Target Address</ControlLabel>
            <FormGroup controlId="MultiAddressWithdraw">
              <FormControl
                type="string"
                value={this.state.destinationAddress}
                onChange={this.handleChangeDestinationAddress}
              />
              <Button
                bsSize="large"
                onClick={this.transfer}
                disabled={this.state.running}
              >
              Consolidate selected funds
              </Button>
            </FormGroup>
          </div>
          )}
          {this.state.paused && (
            <Alert>
              <strong>Synchronization paused</strong>
              <p>
                Temporary total on this account:{" "}
                {(
                  this.state.totalBalance /
                  10 ** Networks[this.state.coin].satoshi
                ).toString() +
                  " " +
                  Networks[this.state.coin].unit}
              </p>
            </Alert>
          )}
        </form>
        <h2> Balances by address </h2>
        <BootstrapTable
          data={this.state.result}
          striped={true}
          hover={true}
          pagination
          options={this.addressesOptions}
          selectRow={selectRow}
        >
          <TableHeaderColumn dataField="path" dataSort={true} isKey={true}>
            Derivation path
          </TableHeaderColumn>
          <TableHeaderColumn dataField="address" dataSort={true}>
            Address
          </TableHeaderColumn>
          <TableHeaderColumn dataField="balance" dataSort={true}>
            Balance
          </TableHeaderColumn>
        </BootstrapTable>
        {(this.state.done || this.state.paused) && (
          <div>
            {this.state.selectedTxs && (
              <div>
                <h3> Txs for {this.state.selectedAddress} </h3>
                <BootstrapTable
                  data={this.state.selectedTxs}
                  striped={true}
                  hover={true}
                  pagination
                  options={this.txsOptions}
                >
                  <TableHeaderColumn
                    dataField="hash"
                    dataSort={true}
                    isKey={true}
                    ty
                  >
                    Hash
                  </TableHeaderColumn>
                  <TableHeaderColumn dataField="balance" dataSort={true}>
                    Balance change
                  </TableHeaderColumn>
                  <TableHeaderColumn dataField="time" dataSort={true}>
                    Time
                  </TableHeaderColumn>
                </BootstrapTable>
              </div>
            )}
            {this.state.selectedTx && (
              <div
                style={{
                  textAlign: "left"
                }}
              >
                <h4>Tx details: </h4>
                <Inspector
                  data={this.state.selectedTx}
                  expandLevel={2}
                  style={{
                    fontSize: "20px"
                  }}
                />
                <br />
                <br />
                <br />
              </div>
            )}
          </div>
        )}
      </div>
      
    );
  }
}

export default MultiAddressWithdraw;